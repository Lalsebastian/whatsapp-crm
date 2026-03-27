import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Users, CalendarDays, BarChart3, Settings, HelpCircle,
  MessageSquare, Search, Bell, RefreshCw, Moon, Sun, Phone, Building2,
  Tag, Download, CheckCircle2, Clock, ChevronDown, Sparkles, Zap,
  TrendingUp, MessageCircle, Hash, Inbox, Utensils, Wrench, Scissors,
  Home as HomeIcon, ChevronRight, ArrowUpRight, Activity, Shield,
  Mail, User
} from "lucide-react";
import "./App.css";

/* ── Config ──────────────────────────────────────────────────── */
const SUPABASE_URL = "https://faadfckdtjkqeqfhtcgi.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYWRmY2tkdGprcWVxZmh0Y2dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NjUzNDUsImV4cCI6MjA4OTA0MTM0NX0.LypDChCOPsF9W3C5WIM99Yfsz2Gj8_DZ9vVQehE03tk";

const BIZ_CONFIG = {
  RESTAURANT:    { label: "Restaurant",     Icon: Utensils  },
  HOME_SERVICES: { label: "Home Services",  Icon: Wrench    },
  SALON:         { label: "Salon & Beauty", Icon: Scissors  },
  REAL_ESTATE:   { label: "Real Estate",    Icon: HomeIcon  },
};

const STATUS_CONFIG = {
  new:       { label: "New",       cls: "s-new"       },
  contacted: { label: "Contacted", cls: "s-contacted"  },
  confirmed: { label: "Confirmed", cls: "s-confirmed"  },
  closed:    { label: "Closed",    cls: "s-closed"     },
};

const STAT_CONFIG = [
  { key: "ALL",       label: "Total Leads",  Icon: BarChart3     },
  { key: "new",       label: "New",          Icon: Zap           },
  { key: "contacted", label: "Contacted",    Icon: MessageCircle },
  { key: "confirmed", label: "Confirmed",    Icon: CheckCircle2  },
  { key: "closed",    label: "Closed",       Icon: Shield        },
];

const NAV_ITEMS = [
  { Icon: LayoutDashboard, label: "Dashboard",  active: true },
  { Icon: Users,           label: "All Leads"               },
  { Icon: CalendarDays,    label: "Calendar"                },
  { Icon: BarChart3,       label: "Analytics"               },
  { Icon: Settings,        label: "Settings"                },
  { Icon: HelpCircle,      label: "Help"                    },
];

/* ── API helpers ─────────────────────────────────────────────── */
const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function fetchMessages() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?select=*&order=created_at.desc&limit=50`,
    { headers }
  );
  return res.json();
}

async function fetchLeads() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?select=*&order=created_at.desc`,
    { headers }
  );
  return res.json();
}

async function updateStatus(id, status) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ status }),
  });
}

/* ── Utility ─────────────────────────────────────────────────── */
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Animated counter hook ───────────────────────────────────── */
function useCountUp(target) {
  const [count, setCount] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) return;
    const duration = 600;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease out cubic
      setCount(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return count;
}

/* ── Stat Card ───────────────────────────────────────────────── */
function StatCard({ statKey, label, Icon, count, isActive, onClick }) {
  const animated = useCountUp(count);
  return (
    <motion.div
      className={`stat-card ${isActive ? "active" : ""}`}
      data-stat={statKey}
      onClick={onClick}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.97 }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="stat-card-icon">
        <Icon size={18} strokeWidth={2} />
      </div>
      <div className="stat-card-num">{animated}</div>
      <div className="stat-card-label">{label}</div>
      {statKey !== "ALL" && count > 0 && (
        <span className="stat-card-trend">
          <ArrowUpRight size={10} /> Active
        </span>
      )}
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const [leads, setLeads]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [bizFilter, setBizFilter]       = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selected, setSelected]         = useState(null);
  const [updating, setUpdating]         = useState(null);
  const [lastRefresh, setLastRefresh]   = useState(new Date());
  const [messages, setMessages]         = useState([]);
  const [activeTab, setActiveTab]       = useState("leads");
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [theme, setTheme]               = useState(
    () => localStorage.getItem("crm-theme") || "dark"
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

  /* ── Messages grouping ───────────────────────────────────── */
  const sessionMap = {};
  [...messages].reverse().forEach(m => {
    if (!sessionMap[m.phone]) sessionMap[m.phone] = [];
    sessionMap[m.phone].push(m);
  });
  const sessions = Object.entries(sessionMap).sort(
    ([, a], [, b]) => new Date(b[b.length - 1].created_at) - new Date(a[a.length - 1].created_at)
  );
  const activeSession = selectedPhone ? sessionMap[selectedPhone] : null;

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <div data-theme={theme} className="app-shell">

      {/* ══ SIDEBAR ══════════════════════════════════════════ */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <MessageSquare size={18} strokeWidth={2.5} />
          </div>
          <div>
            <div className="sidebar-logo-text">WhatsApp CRM</div>
            <div className="sidebar-logo-sub">Lead Manager</div>
          </div>
        </div>

        <p className="sidebar-section-label">Menu</p>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ Icon: NavIcon, label, active }) => (
            <button key={label} className={`nav-item ${active ? "active" : ""}`}>
              <span className="nav-item-icon">
                <NavIcon size={16} strokeWidth={active ? 2.5 : 2} />
              </span>
              {label}
              {label === "All Leads" && leads.length > 0 && (
                <span className="nav-badge">{leads.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="sidebar-footer">
          <div className="sidebar-footer-title">
            <Sparkles size={13} />
            WhatsApp Bot
          </div>
          <div className="sidebar-footer-sub">
            Connect your chatbot to capture leads automatically.
          </div>
          <button className="sidebar-footer-btn">
            View Setup
            <ChevronRight size={13} />
          </button>
        </div>
      </aside>

      {/* ══ MAIN ═════════════════════════════════════════════ */}
      <div className="main">

        {/* ── Topbar ────────────────────────────────────── */}
        <header className="topbar">
          <div className="topbar-search">
            <span className="topbar-search-icon">
              <Search size={14} />
            </span>
            <input type="text" placeholder="Search leads, contacts…" />
          </div>

          <div className="topbar-right">
            <button className="theme-btn" onClick={toggleTheme} title="Toggle theme">
              {theme === "light"
                ? <Moon size={15} />
                : <Sun size={15} />
              }
            </button>

            <button className="topbar-icon-btn" title="Notifications">
              <Bell size={15} />
              <span className="notif-dot" />
            </button>

            <button
              className="topbar-icon-btn"
              onClick={load}
              title="Refresh"
              disabled={loading}
            >
              <span className={loading ? "spin" : ""}>
                <RefreshCw size={14} />
              </span>
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

        {/* ── Content ───────────────────────────────────── */}
        <div className="content">

          {/* Page Header */}
          <div className="page-header">
            <div>
              <div className="page-title-wrap">
                <div className="page-title-icon">
                  {activeTab === "leads"
                    ? <LayoutDashboard size={18} />
                    : <Inbox size={18} />
                  }
                </div>
                <h1 className="page-title">
                  {activeTab === "leads" ? "Leads Dashboard" : "Live Messages"}
                </h1>
              </div>
              <p className="page-subtitle">
                {activeTab === "leads"
                  ? "Track, manage and follow up with all your WhatsApp leads."
                  : "All incoming WhatsApp messages in real-time."}
              </p>
            </div>

            <div className="page-actions">
              <div className="tab-switcher">
                <button
                  className={`tab-btn ${activeTab === "leads" ? "active" : ""}`}
                  onClick={() => setActiveTab("leads")}
                >
                  <Users size={13} />
                  Leads
                </button>
                <button
                  className={`tab-btn ${activeTab === "messages" ? "active" : ""}`}
                  onClick={() => setActiveTab("messages")}
                >
                  <MessageCircle size={13} />
                  Live Messages
                  {messages.length > 0 && (
                    <span className="nav-badge" style={{ marginLeft: 2 }}>
                      {messages.length}
                    </span>
                  )}
                </button>
              </div>

              {activeTab === "leads" && (
                <>
                  <button className="btn" onClick={load} disabled={loading}>
                    <span className={loading ? "spin" : ""}><RefreshCw size={13} /></span>
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                  <button className="btn btn-primary">
                    <Download size={13} />
                    Export
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ── Stat Cards ──────────────────────────────── */}
          <div className="stats-grid">
            {STAT_CONFIG.map(({ key, label, Icon: StatIcon }) => (
              <StatCard
                key={key}
                statKey={key}
                label={label}
                Icon={StatIcon}
                count={statCounts[key] ?? 0}
                isActive={
                  key === "ALL"
                    ? statusFilter === "ALL" && bizFilter === "ALL"
                    : statusFilter === key
                }
                onClick={() => {
                  if (key === "ALL") { setStatusFilter("ALL"); setBizFilter("ALL"); }
                  else setStatusFilter(key);
                }}
              />
            ))}
          </div>

          {/* ══ MESSAGES TAB ════════════════════════════════ */}
          {activeTab === "messages" && (
            <motion.div
              className="inbox-shell"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {/* Session list */}
              <div className="inbox-sidebar">
                <div className="inbox-sidebar-header">
                  <span>Sessions</span>
                  <div className="messages-live-indicator">
                    <span className="live-dot" />
                    Live
                  </div>
                </div>

                <div className="inbox-sidebar-sessions">
                  {sessions.length === 0 ? (
                    <div className="inbox-empty">
                      <MessageCircle size={28} strokeWidth={1.5} style={{ opacity: 0.3 }} />
                      <span>No messages yet</span>
                    </div>
                  ) : sessions.map(([phone, msgs]) => {
                    const last = msgs[msgs.length - 1];
                    const isActive = selectedPhone === phone;
                    return (
                      <motion.div
                        key={phone}
                        className={`session-row ${isActive ? "active" : ""}`}
                        onClick={() => setSelectedPhone(isActive ? null : phone)}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2 }}
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
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Message thread */}
              <div className="inbox-thread">
                {!activeSession ? (
                  <div className="inbox-thread-empty">
                    <div className="inbox-thread-empty-icon">
                      <MessageSquare size={28} strokeWidth={1.5} />
                    </div>
                    <div className="empty-title">Select a session</div>
                    <div className="empty-sub">Click a contact to view their messages</div>
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={selectedPhone}
                      style={{ display: "flex", flexDirection: "column", height: "100%" }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="inbox-thread-header">
                        <div className="session-avatar">{selectedPhone.slice(-2)}</div>
                        <div>
                          <div className="inbox-thread-phone">+{selectedPhone}</div>
                          <div className="inbox-thread-sub">
                            <Activity size={10} />
                            {activeSession.length} messages
                          </div>
                        </div>
                      </div>

                      <div className="inbox-thread-messages">
                        {activeSession.map((m, i) => (
                          <motion.div
                            key={m.id ?? i}
                            className="thread-msg"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.15, delay: i * 0.03 }}
                          >
                            <span className={`message-type-badge ${m.type === "button" ? "badge-button" : "badge-text"}`}>
                              {m.type === "button"
                                ? <><Hash size={9} /> Button</>
                                : <><Mail size={9} /> Text</>
                              }
                            </span>
                            <span className="thread-msg-content">{m.content}</span>
                            <span className="thread-msg-time">{timeAgo(m.created_at)}</span>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>
            </motion.div>
          )}

          {/* ══ LEADS TAB ════════════════════════════════════ */}
          {activeTab === "leads" && (
            <motion.div
              className="main-split"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

                {/* Table header */}
                <div className="table-card-header">
                  <div>
                    <div className="table-card-title">All Leads</div>
                    <div className="table-card-sub">
                      <Users size={11} />
                      {filtered.length} {filtered.length === 1 ? "lead" : "leads"} · filter by business
                    </div>
                  </div>
                  <div className="filter-chips">
                    {[{ key: "ALL", label: "All" },
                      ...Object.entries(BIZ_CONFIG).map(([k, v]) => ({ key: k, label: v.label, Icon: v.Icon }))
                    ].map(({ key, label, Icon: ChipIcon }) => (
                      <button
                        key={key}
                        className={`chip ${bizFilter === key ? "active" : ""}`}
                        onClick={() => setBizFilter(key)}
                      >
                        {ChipIcon && <ChipIcon size={11} />}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Table body */}
                <div className="table-scroll">
                  {loading ? (
                    <div className="empty-state">
                      <div className="loading-spinner">
                        <RefreshCw size={28} strokeWidth={1.5} />
                      </div>
                      <div className="empty-title" style={{ marginTop: 10 }}>Loading leads…</div>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon-wrap">
                        <Users size={28} strokeWidth={1.5} />
                      </div>
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
                          const biz   = BIZ_CONFIG[lead.business_type];
                          const st    = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
                          const isSel = selected?.id === lead.id;

                          return (
                            <motion.tr
                              key={lead.id}
                              className={`lead-row ${isSel ? "selected" : ""}`}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ duration: 0.15, delay: Math.min(i * 0.012, 0.25) }}
                              onClick={() => setSelected(isSel ? null : lead)}
                            >
                              <td>
                                <span className="biz-chip">
                                  {biz ? <biz.Icon size={11} /> : null}
                                  {biz?.label || lead.business_type}
                                </span>
                              </td>
                              <td>
                                <span className="cell-name">
                                  {lead.name || <span style={{ color: "var(--text-3)" }}>—</span>}
                                </span>
                              </td>
                              <td>
                                <span className="cell-mono">+{lead.phone}</span>
                              </td>
                              <td>
                                <span className="cell-text">{lead.service || lead.intent || "—"}</span>
                              </td>
                              <td>
                                <span className="cell-mono">{lead.booking_date || "—"}</span>
                              </td>
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
                                    style={{
                                      background: theme === "dark" ? "#0d0f1a" : "#fff",
                                      color: "inherit",
                                    }}
                                  >
                                    {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                                      <option key={k} value={k}>{v.label}</option>
                                    ))}
                                  </select>
                                  <ChevronDown size={9} className="status-chevron" />
                                </div>
                              </td>
                              <td>
                                <span className="cell-muted">{timeAgo(lead.created_at)}</span>
                              </td>
                            </motion.tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* ── Detail Panel ──────────────────────────── */}
              <AnimatePresence>
                {selectedLead && (
                  <motion.aside
                    key={selectedLead.id}
                    className="detail-panel"
                    initial={{ opacity: 0, x: 24, width: 0 }}
                    animate={{ opacity: 1, x: 0, width: 300 }}
                    exit={{ opacity: 0, x: 24, width: 0 }}
                    transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
                  >
                    <div>
                      <div className="detail-eyebrow">
                        <Tag size={10} />
                        Lead Details
                      </div>
                      <div className="detail-name">
                        {selectedLead.name || "Unnamed Lead"}
                      </div>
                    </div>

                    <div className="detail-card">
                      <div className="detail-row">
                        <div className="detail-row-icon"><Phone size={13} /></div>
                        <div>
                          <div className="detail-row-label">Phone</div>
                          <div className="detail-row-value" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                            +{selectedLead.phone}
                          </div>
                        </div>
                      </div>
                      <div className="detail-row">
                        <div className="detail-row-icon"><Building2 size={13} /></div>
                        <div>
                          <div className="detail-row-label">Business</div>
                          <div className="detail-row-value">
                            {BIZ_CONFIG[selectedLead.business_type]?.label || selectedLead.business_type}
                          </div>
                        </div>
                      </div>
                      <div className="detail-row">
                        <div className="detail-row-icon"><Activity size={13} /></div>
                        <div>
                          <div className="detail-row-label">Status</div>
                          <div style={{ marginTop: 4 }}>
                            <span
                              className={`status-pill ${STATUS_CONFIG[selectedLead.status]?.cls || "s-new"}`}
                              style={{ padding: "3px 10px", fontSize: 11 }}
                            >
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
                      <Clock size={11} />
                      Received {timeAgo(selectedLead.created_at)}
                    </div>
                  </motion.aside>
                )}
              </AnimatePresence>
            </motion.div>
          )}

        </div>
      </div>
    </div>
  );
}
