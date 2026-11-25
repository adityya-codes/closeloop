import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const PLAN_PRICES: Record<string, number> = {
  starter: 999,
  pro: 2999,
  enterprise: 9999,
};

interface Message {
  sender: "customer" | "ai";
  text: string;
}

interface Lead {
  phone: string;
  status: "NEW" | "LINK_SENT" | "WON";
  plan: string | null;
  payment_link: string | null;
  messages: Message[];
}

// Turns any http:// link in an AI reply into a clickable checkout link
function renderTextWithLinks(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    part.startsWith("http") ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        style={{ color: "#2563eb", textDecoration: "underline", wordBreak: "break-all" }}
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function App() {
  const [phone, setPhone] = useState("9876543210");
  const [input, setInput] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLeads = async () => {
    try {
      const res = await fetch(`${API_URL}/leads`);
      const data: Lead[] = await res.json();
      setLeads(data);
    } catch {
      // Backend might be restarting
    }
  };

  // Poll live CRM data every 2 seconds so WON updates appear automatically
  useEffect(() => {
    fetchLeads();
    const timer = setInterval(fetchLeads, 2000);
    return () => clearInterval(timer);
  }, []);

  const activeLead = leads.find((l) => l.phone === phone);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const text = input.trim();
    setInput("");
    setLoading(true);

    try {
      await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: text }),
      });
      await fetchLeads();
    } finally {
      setLoading(false);
    }
  };

  const wonLeads = leads.filter((l) => l.status === "WON");
  const totalRevenue = wonLeads.reduce(
    (sum, l) => sum + (l.plan ? PLAN_PRICES[l.plan] || 0 : 0),
    0
  );

  const badgeColor = (status: Lead["status"]) => {
    if (status === "WON") return { bg: "#dcfce7", text: "#166534" };
    if (status === "LINK_SENT") return { bg: "#fef9c3", text: "#854d0e" };
    return { bg: "#e2e8f0", text: "#334155" };
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#f8fafc", color: "#0f172a", padding: "24px" }}>
      <header style={{ maxWidth: 1180, margin: "0 auto 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>CloseLoop AI</h1>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 14 }}>
            AI Brochure RAG + Automated Payment Checkout + Live Webhook Settlement
          </p>
        </div>
        <span style={{ background: "#dcfce7", color: "#166534", padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600 }}>
          Live Sync Active
        </span>
      </header>

      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 24 }}>
        {/* LEFT PANEL: Customer Chat Simulator */}
        <section style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", height: 600 }}>
          <div style={{ padding: 16, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Customer Chat Simulator</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 13, color: "#64748b" }}>Phone:</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", width: 120 }}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {!activeLead || activeLead.messages.length === 0 ? (
              <p style={{ color: "#94a3b8", textAlign: "center", marginTop: 40, fontSize: 14 }}>
                Ask about plans, pricing, refunds, or say "I want to buy the Pro plan".
              </p>
            ) : (
              activeLead.messages.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    alignSelf: m.sender === "customer" ? "flex-end" : "flex-start",
                    background: m.sender === "customer" ? "#2563eb" : "#f1f5f9",
                    color: m.sender === "customer" ? "#fff" : "#0f172a",
                    padding: "10px 14px",
                    borderRadius: 12,
                    maxWidth: "82%",
                    whiteSpace: "pre-wrap",
                    fontSize: 14,
                    lineHeight: 1.45,
                  }}
                >
                  {m.sender === "ai" ? renderTextWithLinks(m.text) : m.text}
                </div>
              ))
            )}
          </div>

          <form onSubmit={sendMessage} style={{ padding: 12, borderTop: "1px solid #e2e8f0", display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a customer message..."
              style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14 }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: "pointer" }}
            >
              {loading ? "..." : "Send"}
            </button>
          </form>
        </section>

        {/* RIGHT PANEL: Operator CRM Dashboard */}
        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>Total Leads</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{leads.length}</div>
            </div>
            <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>Deals Won</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>{wonLeads.length}</div>
            </div>
            <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>Settled Revenue</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>₹{totalRevenue.toLocaleString("en-IN")}</div>
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 16, flex: 1 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Live Lead Pipeline</h3>
            {leads.length === 0 ? (
              <p style={{ color: "#94a3b8", fontSize: 14 }}>No leads yet. Send a message on the left to start.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", color: "#64748b" }}>
                    <th style={{ padding: "8px 4px" }}>Phone</th>
                    <th style={{ padding: "8px 4px" }}>Plan</th>
                    <th style={{ padding: "8px 4px" }}>Status</th>
                    <th style={{ padding: "8px 4px" }}>Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const colors = badgeColor(lead.status);
                    return (
                      <tr
                        key={lead.phone}
                        onClick={() => setPhone(lead.phone)}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          cursor: "pointer",
                          background: lead.phone === phone ? "#f8fafc" : "transparent",
                        }}
                      >
                        <td style={{ padding: "10px 4px", fontWeight: 600 }}>{lead.phone}</td>
                        <td style={{ padding: "10px 4px", textTransform: "capitalize" }}>{lead.plan || "—"}</td>
                        <td style={{ padding: "10px 4px" }}>
                          <span style={{ background: colors.bg, color: colors.text, padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                            {lead.status}
                          </span>
                        </td>
                        <td style={{ padding: "10px 4px", color: "#64748b" }}>{lead.messages.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}