from fastapi.middleware.cors import CORSMiddleware
import math
import hashlib
import hmac
import json
import os
import re
import uuid
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from openai import OpenAI

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.getenv("GROQ_API_KEY"),
)

WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "dev_webhook_secret")

PLANS = {
    "starter": {"name": "Starter Plan", "price": 999},
    "pro": {"name": "Pro Plan", "price": 2999},
    "enterprise": {"name": "Enterprise Plan", "price": 9999},
}

# In-memory stores for today (JS: const LEADS = {}; const ORDERS = {};)
LEADS = {}
ORDERS = {}

gemini_client = OpenAI(
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    api_key=os.getenv("GEMINI_API_KEY"),
)

def get_vector(text: str) -> list[float]:
    res = gemini_client.embeddings.create(model="gemini-embedding-2", input=text)
    return res.data[0].embedding

def similarity(vec_a: list[float], vec_b: list[float]) -> float:
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    len_a = math.sqrt(sum(a * a for a in vec_a))
    len_b = math.sqrt(sum(b * b for b in vec_b))
    return dot / (len_a * len_b)

with open("brochure.txt", "r", encoding="utf-8") as f:
    CHUNKS = [c.strip() for c in f.read().split("\n\n") if c.strip()]

CHUNK_VECTORS = [get_vector(chunk) for chunk in CHUNKS]

def search_brochure(query: str) -> str:
    query_vec = get_vector(query)
    scored = [(similarity(query_vec, vec), chunk) for chunk, vec in zip(CHUNKS, CHUNK_VECTORS)]
    scored.sort(key=lambda x: x[0], reverse=True)
    print(f"RAG match score: {scored[0][0]:.2f} -> {scored[0][1][:45]}...")
    top = [chunk for score, chunk in scored[:2] if score > 0.35]
    return "\n\n".join(top) if top else "NO RELEVANT INFO FOUND."

BASE_URL = (os.getenv("RENDER_EXTERNAL_URL") or "http://127.0.0.1:8000").rstrip("/")

def create_payment_link(plan_key: str, phone: str) -> str:
    order_id = f"plink_{uuid.uuid4().hex[:8]}"
    ORDERS[order_id] = {"order_id": order_id, "phone": phone, "plan": plan_key, "paid": False}
    return f"{BASE_URL}/mock-checkout/{order_id}"

class ChatRequest(BaseModel):
    phone: str = "9999999999"
    message: str

@app.post("/chat")
def chat(req: ChatRequest):
    lead = LEADS.setdefault(
        req.phone,
        {"phone": req.phone, "status": "NEW", "plan": None, "payment_link": None, "messages": []},
    )
    context = search_brochure(req.message)

    system_prompt = f"""You are a concise sales assistant.
Answer ONLY using COMPANY DATA. Never invent prices or features.
Return valid JSON ONLY in this exact format:
{{"reply": "your helpful message", "buy_plan": null}}

Set "buy_plan" to "starter", "pro", or "enterprise" ONLY when the customer clearly wants to buy, pay, or subscribe to that plan. Otherwise set it to null.

COMPANY DATA:
{context}"""

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.message},
        ],
    )

    ai_data = json.loads(response.choices[0].message.content)
    reply = ai_data["reply"]
    buy_plan = ai_data.get("buy_plan")
    payment_link = None

    if buy_plan in PLANS:
        payment_link = create_payment_link(buy_plan, req.phone)
        lead["status"] = "LINK_SENT"
        lead["plan"] = buy_plan
        lead["payment_link"] = payment_link
        reply = f"{reply}\n\nPay ₹{PLANS[buy_plan]['price']} here: {payment_link}"

    lead["messages"].append({"sender": "customer", "text": req.message})
    lead["messages"].append({"sender": "ai", "text": reply})

    return {"reply": reply, "status": lead["status"], "payment_link": payment_link}

# 1. Mock Razorpay Checkout Page (opens in browser when customer clicks the link)
@app.get("/mock-checkout/{order_id}", response_class=HTMLResponse)
def mock_checkout(order_id: str):
    order = ORDERS.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    plan = PLANS[order["plan"]]
    payload_str = json.dumps(
        {"event": "payment_link.paid", "order_id": order_id, "phone": order["phone"], "plan": order["plan"]},
        separators=(",", ":"),
    )
    # Generates the exact HMAC-SHA256 signature Razorpay sends in X-Razorpay-Signature
    signature = hmac.new(WEBHOOK_SECRET.encode(), payload_str.encode(), hashlib.sha256).hexdigest()

    return f"""
    <html>
      <body style="font-family:sans-serif;max-width:420px;margin:60px auto;padding:24px;border:1px solid #ddd;border-radius:12px;">
        <h2>CloseLoop Test Checkout</h2>
        <p><b>Plan:</b> {plan['name']}</p>
        <p><b>Amount:</b> ₹{plan['price']}</p>
        <p><b>Customer:</b> {order['phone']}</p>
        <button id="payBtn" style="padding:12px 20px;background:#2563eb;color:white;border:none;border-radius:8px;cursor:pointer;font-size:16px;">
          Simulate Successful Payment
        </button>
        <p id="msg" style="margin-top:16px;font-weight:bold;"></p>
        <script>
          const rawBody = {json.dumps(payload_str)};
          const signature = {json.dumps(signature)};
          document.getElementById("payBtn").onclick = async () => {{
            const res = await fetch("/webhooks/razorpay", {{
              method: "POST",
              headers: {{ "Content-Type": "application/json", "X-Razorpay-Signature": signature }},
              body: rawBody
            }});
            const data = await res.json();
            document.getElementById("msg").innerText = "Webhook Response: " + JSON.stringify(data);
          }};
        </script>
      </body>
    </html>
    """

# 2. REAL Razorpay-Spec Webhook Handler (verifies HMAC-SHA256 + idempotent)
@app.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request):
    raw_body = await request.body()
    received_sig = request.headers.get("X-Razorpay-Signature", "")
    expected_sig = hmac.new(WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()

    # Reject tampered or fake webhook calls
    if not hmac.compare_digest(expected_sig, received_sig):
        raise HTTPException(status_code=400, detail="Invalid Razorpay signature")

    event = json.loads(raw_body)
    order = ORDERS.get(event.get("order_id"))
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Idempotency check: ignore duplicate webhooks if already paid
    if order["paid"]:
        return {"status": "already_processed"}

    order["paid"] = True
    lead = LEADS.get(order["phone"])
    if lead:
        lead["status"] = "WON"
        lead["messages"].append({
            "sender": "ai",
            "text": f"Payment received for {PLANS[order['plan']]['name']}! Your account is now active.",
        })

    return {"status": "ok", "lead_status": "WON"}

@app.get("/leads")
def get_leads():
    return list(LEADS.values())