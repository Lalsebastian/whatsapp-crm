import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./App.css";

const SUPABASE_URL = "https://faadfckdtjkqeqfhtcgi.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYWRmY2tkdGprcWVxZmh0Y2dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NjUzNDUsImV4cCI6MjA4OTA0MTM0NX0.LypDChCOPsF9W3C5WIM99Yfsz2Gj8_DZ9vVQehE03tk";

const BIZ_CONFIG = {
  RESTAURANT:    { label: "Restaurant",     emoji: "🍽" },
  HOME_SERVICES: { label: "Home Services",  emoji: "🔧" },
  SALON:         { label: "Salon & Beauty", emoji: "💅" },
  REAL_ESTATE:   { label: "Real Estate",    emoji: "🏠" },
};

const STATUS_CONFIG = {
  new:       { label: "New",       cls: "s-new" },
  contacted: { label: "Contacted", cls: "s-contacted" },
  confirmed: { label: "Confirmed", cls: "s-confirmed" },
  closed:    { label: "Closed",    cls: "s-closed" },
};

const STAT_COLORS = {
  ALL:       { icon: "📊", bg: "var(--stat-1-bg)", text: "var(--stat-1-text)", label: "Total Leads" },
  new:       { icon: "🟢", bg: "var(--stat-1-bg)", text: "var(--stat-1-text)", label: "New" },
  contacted: { icon: "💬", bg: "var(--stat-3-bg)", text: "var(--stat-3-text)", label: "Contacted" },
  confirmed: { icon: "✅", bg: "var(--stat-2-bg)", text: "var(--stat-2-text)", label: "Confirmed" },
  closed:    { icon: "🔒", bg: "var(--stat-5-bg)", text: "var(--stat-5-text)", label: "Closed" },
};

const NAV_ITEMS = [
  { icon: "⊞", label: "Dashboard", active: true },
  { icon: "👥", label: "All Leads" },
  { icon: "📅", label: "Calendar" },
  { icon: "📈", label: "Analytics" },
  { icon: "⚙️", label: "Settings" },
  { icon: "❓", label: "Help" },
];

async function fetchMessages() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?select=*&order=created_at.desc&limit=50`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  return res.json();
}

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
  const [leads, setLeads]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [bizFilter, setBizFilter]     = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selected, setSelected]       = useState(null);
  const [updating, setUpdating]       = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [messages, setMessages]       = useState([]);
  const [activeTab, setActiveTab]     = useState("leads");
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [theme, setTheme]             = useState(
    () => localStorage.getItem("crm-theme") || "light"
  );

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("crm-theme", next);
  };

  const load = async () => {
    setLoading(true);
    const data = await fetchLeads();
    if (Array.isArray(data)) setLeads(data);
    setLastRefresh(new Date());
    setLoading(false);
  };

  const loadMessages = async () => {
    const data = await fetchMessages();
    if (Array.isArray(data)) setMessages(data);
  };

  useEffect(() => { load(); loadMessages(); }, []);

  // auto-refresh messages every 5 seconds
  useEffect(() => {
    const interval = setInterval(loadMessages, 5000);
    return () => clearInterval(interval);
  }, []);

  const statCounts = {
    ALL:       leads.length,
    new:       leads.filter(l => l.status === "new").length,
    contacted: leads.filter(l => l.status === "contacted").length,
    confirmed: leads.filter(l => l.status === "confirmed").length,
    closed:    leads.filter(l => l.status === "closed").length,
  };

  const filtered = leads.filter(l => {
    const bizMatch    = bizFilter === "ALL" || l.business_type === bizFilter;
    const statusMatch = statusFilter === "ALL" || l.status === statusFilter;
    return bizMatch && statusMatch;
  });

  const handleStatusChange = async (id, newStatus) => {
    setUpdating(id);
    await updateStatus(id, newStatus);
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l));
    if (selected?.id === id) setSelected(prev => ({ ...prev, status: newStatus }));
    setUpdating(null);
  };

  const selectedLead = selected ? leads.find(l => l.id === selected.id) : null;

  return (
    <div data-theme={theme} className="app-shell">

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">💬</div>
          <div>
            <div className="sidebar-logo-text">WhatsApp CRM</div>
            <div className="sidebar-logo-sub">Lead Manager</div>
          </div>
        </div>

        <p className="sidebar-section-label">Menu</p>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button key={item.label} className={`nav-item ${item.active ? "active" : ""}`}>
              <span className="nav-item-icon">{item.icon}</span>
              {item.label}
              {item.label === "All Leads" && leads.length > 0 && (
                <span className="nav-badge">{leads.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <div className="sidebar-footer">
          <div className="sidebar-footer-title">WhatsApp Bot</div>
          <div className="sidebar-footer-sub">Connect your chatbot to capture leads automatically</div>
          <button className="sidebar-footer-btn">View Setup →</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="main">

        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-search">
            <span className="topbar-search-icon">🔍</span>
            <input type="text" placeholder="Search leads..." />
          </div>

          <div className="topbar-right">
            <button className="theme-btn" onClick={toggleTheme} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
              {theme === "light" ? "🌙" : "☀️"}
            </button>
            <button className="topbar-icon-btn" title="Notifications">🔔</button>
            <button className="topbar-icon-btn" onClick={load} title="Refresh" disabled={loading}>
              <span className={loading ? "spin" : ""} style={{ fontSize: 14 }}>↻</span>
            </button>
            <div className="topbar-user">
              <div className="topbar-avatar">A</div>
              <div>
                <div className="topbar-user-name">Admin</div>
                <div className="topbar-user-email">Updated {timeAgo(lastRefresh)}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="content">

          {/* Page header */}
          <div className="page-header">
            <div>
              <h1 className="page-title">{activeTab === "leads" ? "Leads Dashboard" : "Live Messages"}</h1>
              <p className="page-subtitle">{activeTab === "leads" ? "Track, manage and follow up with all your WhatsApp leads." : "All incoming WhatsApp messages in real-time."}</p>
            </div>
            <div className="page-actions">
              <div className="tab-switcher">
                <button className={`tab-btn ${activeTab === "leads" ? "active" : ""}`} onClick={() => setActiveTab("leads")}>Leads</button>
                <button className={`tab-btn ${activeTab === "messages" ? "active" : ""}`} onClick={() => setActiveTab("messages")}>
                  Live Messages
                  {messages.length > 0 && <span className="nav-badge" style={{ marginLeft: 6 }}>{messages.length}</span>}
                </button>
              </div>
              {activeTab === "leads" && (
                <>
                  <button className="btn" onClick={load} disabled={loading}>
                    <span className={loading ? "spin" : ""}>↻</span>
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                  <button className="btn btn-primary">+ Export</button>
                </>
              )}
            </div>
          </div>

          {/* Stat cards */}
          <motion.div
            className="stats-grid"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
          >
            {Object.entries(STAT_COLORS).map(([key, cfg]) => (
              <div
                key={key}
                className={`stat-card ${statusFilter === key || (key === "ALL" && statusFilter === "ALL" && bizFilter === "ALL") ? "active" : ""}`}
                onClick={() => {
                  if (key === "ALL") { setStatusFilter("ALL"); setBizFilter("ALL"); }
                  else setStatusFilter(key);
                }}
              >
                <div className="stat-card-icon" style={{ background: cfg.bg }}>
                  <span style={{ fontSize: 16 }}>{cfg.icon}</span>
                </div>
                <div className="stat-card-num">{statCounts[key] ?? 0}</div>
                <div className="stat-card-label">{cfg.label}</div>
                {key !== "ALL" && statCounts[key] > 0 && (
                  <span
                    className="stat-card-trend"
                    style={{ background: cfg.bg, color: cfg.text }}
                  >
                    ↑ Active
                  </span>
                )}
              </div>
            ))}
          </motion.div>

          {/* Live Messages tab */}
          {activeTab === "messages" && (() => {
            // group messages by phone, sorted by latest first
            const sessionMap = {};
            [...messages].reverse().forEach(m => {
              if (!sessionMap[m.phone]) sessionMap[m.phone] = [];
              sessionMap[m.phone].push(m);
            });
            const sessions = Object.entries(sessionMap).sort(
              ([, a], [, b]) => new Date(b[b.length-1].created_at) - new Date(a[a.length-1].created_at)
            );
            const activeSession = selectedPhone ? sessionMap[selectedPhone] : null;

            return (
              <motion.div
                className="inbox-shell"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                {/* Session list */}
                <div className="inbox-sidebar">
                  <div className="inbox-sidebar-header">
                    <span>Sessions</span>
                    <span className="messages-live-dot">● Live</span>
                  </div>
                  {sessions.length === 0 ? (
                    <div className="inbox-empty">No messages yet</div>
                  ) : sessions.map(([phone, msgs]) => {
                    const last = msgs[msgs.length - 1];
                    const isActive = selectedPhone === phone;
                    return (
                      <div
                        key={phone}
                        className={`session-row ${isActive ? "active" : ""}`}
                        onClick={() => setSelectedPhone(isActive ? null : phone)}
                      >
                        <div className="session-avatar">{phone.slice(-2)}</div>
                        <div className="session-info">
                          <div className="session-phone">+{phone}</div>
                          <div className="session-preview">{last.content}</div>
                        </div>
                        <div className="session-meta">
                          <div className="session-time">{timeAgo(last.created_at)}</div>
                          <div className="session-count">{msgs.length}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Message thread */}
                <div className="inbox-thread">
                  {!activeSession ? (
                    <div className="inbox-thread-empty">
                      <div className="empty-icon">💬</div>
                      <div className="empty-title">Select a session</div>
                      <div className="empty-sub">Click a contact on the left to view their messages</div>
                    </div>
                  ) : (
                    <>
                      <div className="inbox-thread-header">
                        <div className="session-avatar">{selectedPhone.slice(-2)}</div>
                        <div>
                          <div className="inbox-thread-phone">+{selectedPhone}</div>
                          <div className="inbox-thread-sub">{activeSession.length} messages</div>
                        </div>
                      </div>
                      <div className="inbox-thread-messages">
                        {activeSession.map((m, i) => (
                          <div key={m.id ?? i} className="thread-msg">
                            <span className={`message-type-badge ${m.type === "button" ? "badge-button" : "badge-text"}`}>
                              {m.type === "button" ? "🔘" : "💬"}
                            </span>
                            <span className="thread-msg-content">{m.content}</span>
                            <span className="thread-msg-time">{timeAgo(m.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })()}

          {/* Table card */}
          {activeTab === "leads" && <motion.div
            className="main-split"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.12 }}
          >
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

              {/* Table header row */}
              <div className="table-card-header">
                <div>
                  <div className="table-card-title">All Leads</div>
                  <div className="table-card-sub">
                    {filtered.length} {filtered.length === 1 ? "lead" : "leads"} · filter by business type
                  </div>
                </div>
                <div className="filter-chips">
                  {[{ key: "ALL", label: "All" }, ...Object.entries(BIZ_CONFIG).map(([k, v]) => ({ key: k, label: v.label }))].map(({ key, label }) => (
                    <button
                      key={key}
                      className={`chip ${bizFilter === key ? "active" : ""}`}
                      onClick={() => setBizFilter(key)}
                    >
                      {key !== "ALL" && BIZ_CONFIG[key] && <span>{BIZ_CONFIG[key].emoji}</span>}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {loading ? (
                  <div className="empty-state">
                    <span className="spin" style={{ fontSize: 24 }}>↻</span>
                    <div className="empty-title" style={{ marginTop: 8 }}>Loading leads…</div>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📭</div>
                    <div className="empty-title">No leads found</div>
                    <div className="empty-sub">Try adjusting your filters above</div>
                  </div>
                ) : (
                  <table className="leads-table">
                    <thead>
                      <tr>
                        {["Business", "Name", "Phone", "Service / Intent", "Date", "Status", "Received"].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((lead, i) => {
                        const biz  = BIZ_CONFIG[lead.business_type] || { emoji: "·", label: lead.business_type };
                        const st   = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
                        const isSel = selected?.id === lead.id;

                        return (
                          <motion.tr
                            key={lead.id}
                            className={`lead-row ${isSel ? "selected" : ""}`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.15, delay: Math.min(i * 0.012, 0.2) }}
                            onClick={() => setSelected(isSel ? null : lead)}
                          >
                            <td>
                              <span className="biz-chip">
                                {biz.emoji} {biz.label}
                              </span>
                            </td>
                            <td>
                              <span className="cell-name">
                                {lead.name || <span style={{ color: "var(--text-3)" }}>—</span>}
                              </span>
                            </td>
                            <td><span className="cell-mono">+{lead.phone}</span></td>
                            <td><span className="cell-text">{lead.service || lead.intent || "—"}</span></td>
                            <td><span className="cell-mono">{lead.booking_date || "—"}</span></td>
                            <td onClick={e => e.stopPropagation()}>
                              <div
                                className={`status-pill ${st.cls}`}
                                style={{ opacity: updating === lead.id ? 0.5 : 1 }}
                              >
                                <span className="status-dot" />
                                <select
                                  className="status-select"
                                  value={lead.status || "new"}
                                  onChange={e => handleStatusChange(lead.id, e.target.value)}
                                  disabled={updating === lead.id}
                                >
                                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                                    <option key={k} value={k}
                                      style={{
                                        background: theme === "dark" ? "#161b22" : "#fff",
                                        color: theme === "dark" ? "#e6edf3" : "#111827"
                                      }}>
                                      {v.label}
                                    </option>
                                  ))}
                                </select>
                                <span style={{ fontSize: 9, opacity: .5 }}>▾</span>
                              </div>
                            </td>
                            <td><span className="cell-muted">{timeAgo(lead.created_at)}</span></td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Detail panel */}
            <AnimatePresence>
              {selectedLead && (
                <motion.aside
                  key={selectedLead.id}
                  className="detail-panel"
                  initial={{ opacity: 0, x: 20, width: 0 }}
                  animate={{ opacity: 1, x: 0, width: 300 }}
                  exit={{ opacity: 0, x: 20, width: 0 }}
                  transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
                >
                  <div>
                    <div className="detail-eyebrow">Lead Details</div>
                    <div className="detail-name">{selectedLead.name || "Unnamed Lead"}</div>
                  </div>

                  <div className="detail-card">
                    <div className="detail-row">
                      <div className="detail-row-icon">📞</div>
                      <div>
                        <div className="detail-row-label">Phone</div>
                        <div className="detail-row-value" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                          +{selectedLead.phone}
                        </div>
                      </div>
                    </div>
                    <div className="detail-row">
                      <div className="detail-row-icon">🏢</div>
                      <div>
                        <div className="detail-row-label">Business</div>
                        <div className="detail-row-value">
                          {BIZ_CONFIG[selectedLead.business_type]?.label || selectedLead.business_type}
                        </div>
                      </div>
                    </div>
                    <div className="detail-row">
                      <div className="detail-row-icon">📋</div>
                      <div>
                        <div className="detail-row-label">Status</div>
                        <div style={{ marginTop: 3 }}>
                          <span className={`status-pill ${STATUS_CONFIG[selectedLead.status]?.cls || "s-new"}`}
                            style={{ padding: "3px 9px", fontSize: 11 }}>
                            <span className="status-dot" />
                            {STATUS_CONFIG[selectedLead.status]?.label || selectedLead.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {(selectedLead.service || selectedLead.intent) && (
                    <div className="detail-card">
                      <div className="detail-section-label">Service / Intent</div>
                      <div className="detail-section-body">
                        {selectedLead.service || selectedLead.intent}
                      </div>
                    </div>
                  )}

                  {selectedLead.booking_date && (
                    <div className="detail-card">
                      <div className="detail-section-label">Booking Date</div>
                      <div className="detail-section-body" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                        {selectedLead.booking_date}
                      </div>
                    </div>
                  )}

                  <div className="detail-footer">
                    Received {timeAgo(selectedLead.created_at)}
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>
          </motion.div>}
        </div>
      </div>
    </div>
  );
}
