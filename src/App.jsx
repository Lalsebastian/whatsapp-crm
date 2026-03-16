import { useState, useEffect } from "react";

const SUPABASE_URL = "https://faadfckdtjkqeqfhtcgi.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYWRmY2tkdGprcWVxZmh0Y2dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NjUzNDUsImV4cCI6MjA4OTA0MTM0NX0.LypDChCOPsF9W3C5WIM99Yfsz2Gj8_DZ9vVQehE03tk";

const BIZ_CONFIG = {
  RESTAURANT:    { label: "Restaurant",     emoji: "🍽", color: "#D85A30", bg: "#FAECE7", text: "#712B13" },
  HOME_SERVICES: { label: "Home services",  emoji: "🔧", color: "#534AB7", bg: "#EEEDFE", text: "#3C3489" },
  SALON:         { label: "Salon & beauty", emoji: "💅", color: "#D4537E", bg: "#FBEAF0", text: "#72243E" },
  REAL_ESTATE:   { label: "Real estate",    emoji: "🏠", color: "#185FA5", bg: "#E6F1FB", text: "#0C447C" },
};

const STATUS_CONFIG = {
  new:       { label: "New",       bg: "#EAF3DE", text: "#3B6D11", dot: "#639922" },
  contacted: { label: "Contacted", bg: "#FAEEDA", text: "#854F0B", dot: "#BA7517" },
  confirmed: { label: "Confirmed", bg: "#E6F1FB", text: "#185FA5", dot: "#378ADD" },
  closed:    { label: "Closed",    bg: "#F1EFE8", text: "#5F5E5A", dot: "#888780" },
};

async function fetchLeads() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?select=*&order=created_at.desc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  return res.json();
}

async function updateStatus(id, status) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ status }),
  });
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Dashboard() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selected, setSelected] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const load = async () => {
    setLoading(true);
    const data = await fetchLeads();
    if (Array.isArray(data)) setLeads(data);
    setLastRefresh(new Date());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = leads.filter(l => {
    const bizMatch = filter === "ALL" || l.business_type === filter;
    const statusMatch = statusFilter === "ALL" || l.status === statusFilter;
    return bizMatch && statusMatch;
  });

  const counts = Object.keys(BIZ_CONFIG).reduce((acc, k) => {
    acc[k] = leads.filter(l => l.business_type === k).length;
    return acc;
  }, {});
  counts.ALL = leads.length;

  const handleStatusChange = async (id, newStatus) => {
    setUpdating(id);
    await updateStatus(id, newStatus);
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l));
    if (selected?.id === id) setSelected(prev => ({ ...prev, status: newStatus }));
    setUpdating(null);
  };

  const selectedLead = selected ? leads.find(l => l.id === selected.id) : null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f0f11",
      color: "#e8e6df",
      fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Google Font */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .lead-row { transition: background 0.15s; cursor: pointer; animation: fadeIn 0.25s ease both; }
        .lead-row:hover { background: #1a1a1f !important; }
        .filter-btn { transition: all 0.15s; border: none; cursor: pointer; font-family: inherit; }
        .filter-btn:hover { opacity: 0.85; }
        .status-select { background: transparent; border: none; font-family: 'DM Mono', monospace; font-size: 11px; cursor: pointer; outline: none; }
        .refresh-btn { transition: opacity 0.15s; }
        .refresh-btn:hover { opacity: 0.7; }
        .detail-panel { animation: fadeIn 0.2s ease; }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #222",
        padding: "18px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#0f0f11",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "#25D366",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16,
          }}>💬</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>WhatsApp CRM</div>
            <div style={{ fontSize: 11, color: "#666", fontFamily: "'DM Mono', monospace" }}>
              {leads.length} total leads · refreshed {timeAgo(lastRefresh)}
            </div>
          </div>
        </div>
        <button className="refresh-btn" onClick={load} style={{
          background: "#1a1a1f", border: "1px solid #2a2a2f",
          borderRadius: 8, padding: "7px 14px",
          color: "#e8e6df", fontSize: 12, cursor: "pointer",
          fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ display: "inline-block", animation: loading ? "spin 0.8s linear infinite" : "none" }}>↻</span>
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 1, borderBottom: "1px solid #1a1a1f", background: "#0a0a0c" }}>
        {[{ key: "ALL", label: "All leads", emoji: "📊" }, ...Object.entries(BIZ_CONFIG).map(([k,v]) => ({ key: k, label: v.label, emoji: v.emoji }))].map(({ key, label, emoji }) => (
          <button key={key} className="filter-btn" onClick={() => setFilter(key)} style={{
            flex: 1, padding: "14px 8px", textAlign: "center",
            background: filter === key ? "#1a1a1f" : "transparent",
            color: filter === key ? "#e8e6df" : "#555",
            borderTop: filter === key ? "2px solid #25D366" : "2px solid transparent",
            fontSize: 12,
          }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{emoji}</div>
            <div style={{ fontWeight: 600, fontSize: 20, fontFamily: "'DM Mono', monospace" }}>
              {key === "ALL" ? counts.ALL : (counts[key] || 0)}
            </div>
            <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{label}</div>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Leads table */}
        <div style={{ flex: 1, overflow: "auto", padding: "0 0 40px" }}>

          {/* Status filter bar */}
          <div style={{ display: "flex", gap: 8, padding: "14px 20px", borderBottom: "1px solid #1a1a1f" }}>
            {["ALL", ...Object.keys(STATUS_CONFIG)].map(s => {
              const cfg = STATUS_CONFIG[s];
              const active = statusFilter === s;
              return (
                <button key={s} className="filter-btn" onClick={() => setStatusFilter(s)} style={{
                  padding: "4px 12px", borderRadius: 20,
                  background: active ? (cfg?.bg || "#25D366") : "#1a1a1f",
                  color: active ? (cfg?.text || "#0f0f11") : "#666",
                  fontSize: 11, fontWeight: 500,
                }}>
                  {s === "ALL" ? "All statuses" : cfg.label}
                </button>
              );
            })}
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#444" }}>
              <div style={{ fontSize: 24, animation: "spin 1s linear infinite", display: "inline-block" }}>↻</div>
              <div style={{ marginTop: 8, fontSize: 12 }}>Loading leads...</div>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center", color: "#333" }}>
              <div style={{ fontSize: 32 }}>📭</div>
              <div style={{ marginTop: 8, fontSize: 13 }}>No leads found</div>
              <div style={{ fontSize: 11, color: "#2a2a2f", marginTop: 4 }}>Try a different filter</div>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1a1a1f" }}>
                  {["Business", "Name", "Phone", "Service / Intent", "Date", "Status", "Received"].map(h => (
                    <th key={h} style={{
                      padding: "10px 16px", textAlign: "left",
                      fontSize: 10, fontWeight: 500, color: "#444",
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      fontFamily: "'DM Mono', monospace",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead, i) => {
                  const biz = BIZ_CONFIG[lead.business_type] || { emoji: "❓", label: lead.business_type, bg: "#1a1a1f", text: "#888" };
                  const st = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
                  const isSelected = selected?.id === lead.id;
                  return (
                    <tr key={lead.id}
                      className="lead-row"
                      onClick={() => setSelected(isSelected ? null : lead)}
                      style={{
                        borderBottom: "1px solid #141416",
                        background: isSelected ? "#1a1a1f" : "transparent",
                        animationDelay: `${i * 0.03}s`,
                      }}
                    >
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "3px 10px", borderRadius: 6,
                          background: biz.bg + "22", color: biz.text,
                          fontSize: 11, fontWeight: 500,
                        }}>
                          <span style={{ fontSize: 13 }}>{biz.emoji}</span>
                          {biz.label}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 500 }}>
                        {lead.name || <span style={{ color: "#333" }}>—</span>}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 11, fontFamily: "'DM Mono', monospace", color: "#888" }}>
                        +{lead.phone}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 12, color: "#aaa" }}>
                        {lead.service || lead.intent || "—"}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 11, fontFamily: "'DM Mono', monospace", color: "#666" }}>
                        {lead.booking_date || "—"}
                      </td>
                      <td style={{ padding: "12px 16px" }} onClick={e => e.stopPropagation()}>
                        <div style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "3px 10px", borderRadius: 6,
                          background: st.bg + "33",
                        }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />
                          <select
                            className="status-select"
                            value={lead.status || "new"}
                            style={{ color: st.text, opacity: updating === lead.id ? 0.5 : 1 }}
                            onChange={e => handleStatusChange(lead.id, e.target.value)}
                            disabled={updating === lead.id}
                          >
                            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                              <option key={k} value={k} style={{ background: "#1a1a1f", color: "#e8e6df" }}>{v.label}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 11, color: "#444", fontFamily: "'DM Mono', monospace" }}>
                        {timeAgo(lead.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail panel */}
        {selectedLead && (
          <div className="detail-panel" style={{
            width: 300, borderLeft: "1px solid #1a1a1f",
            background: "#0a0a0c", padding: 20, overflow: "auto",
            display: "flex", flexDirection: "column", gap: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Lead details</div>
              <button onClick={() => setSelected(null)} style={{
                background: "none", border: "none", color: "#444",
                cursor: "pointer", fontSize: 18, lineHeight: 1,
              }}>×</button>
            </div>

            {/* Business badge */}
            {(() => {
              const biz = BIZ_CONFIG[selectedLead.business_type] || { emoji: "❓", label: selectedLead.business_type, bg: "#1a1a1f", text: "#888" };
              return (
                <div style={{
                  padding: "12px 16px", borderRadius: 10,
                  background: biz.bg + "22", border: `1px solid ${biz.bg}55`,
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <span style={{ fontSize: 24 }}>{biz.emoji}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: biz.text }}>{biz.label}</div>
                    <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
                      {new Date(selectedLead.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Fields */}
            {[
              { label: "Name",     value: selectedLead.name },
              { label: "Phone",    value: `+${selectedLead.phone}` },
              { label: "Service",  value: selectedLead.service },
              { label: "Intent",   value: selectedLead.intent },
              { label: "Date",     value: selectedLead.booking_date },
              { label: "Guests",   value: selectedLead.guests },
              { label: "Address",  value: selectedLead.address },
              { label: "Budget",   value: selectedLead.budget },
              { label: "Location", value: selectedLead.location },
            ].filter(f => f.value).map(f => (
              <div key={f.label}>
                <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Mono', monospace", marginBottom: 4 }}>{f.label}</div>
                <div style={{ fontSize: 13, color: "#ccc" }}>{f.value}</div>
              </div>
            ))}

            {/* Status changer */}
            <div>
              <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>Status</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <button key={k} onClick={() => handleStatusChange(selectedLead.id, k)} style={{
                    padding: "8px 12px", borderRadius: 8, border: "none",
                    background: selectedLead.status === k ? v.bg + "55" : "#141416",
                    color: selectedLead.status === k ? v.text : "#555",
                    fontFamily: "inherit", fontSize: 12, cursor: "pointer",
                    textAlign: "left", display: "flex", alignItems: "center", gap: 8,
                    fontWeight: selectedLead.status === k ? 600 : 400,
                    transition: "all 0.15s",
                    outline: selectedLead.status === k ? `1px solid ${v.dot}55` : "none",
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: v.dot }} />
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}