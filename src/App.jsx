import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Users, CalendarDays, BarChart3, Settings, HelpCircle,
  MessageSquare, Search, Bell, RefreshCw, Moon, Sun, Phone, Building2,
  Tag, Download, CheckCircle2, Clock, ChevronDown, Sparkles, Zap,
  TrendingUp, MessageCircle, Hash, Inbox, Wrench, AlertTriangle,
  ChevronRight, ArrowUpRight, Activity, Shield, Mail, User, ClipboardList
} from "lucide-react";
import "./App.css";

/* ── Config ──────────────────────────────────────────────────── */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const BOOKING_STATUS_CONFIG = {
  pending:     { label: "Pending",     cls: "s-new" },
  confirmed:   { label: "Confirmed",   cls: "s-confirmed" },
  in_progress: { label: "In Progress", cls: "s-contacted" },
  completed:   { label: "Completed",   cls: "s-closed" },
  cancelled:   { label: "Cancelled",   cls: "s-closed" },
  rescheduled: { label: "Rescheduled", cls: "s-contacted" },
};

const COMPLAINT_STATUS_CONFIG = {
  open:        { label: "Open",        cls: "s-new" },
  in_progress: { label: "In Progress", cls: "s-contacted" },
  resolved:    { label: "Resolved",    cls: "s-confirmed" },
  closed:      { label: "Closed",      cls: "s-closed" },
  escalated:   { label: "Escalated",   cls: "s-contacted" },
};

const COMPLAINT_CATEGORY_LABELS = {
  service_not_completed: "Service Not Completed",
  problem_returned: "Problem Returned",
  technician_delayed: "Technician Delayed",
  technician_behaviour: "Technician Behaviour",
  property_damage: "Property Damage",
  payment_issue: "Payment Issue",
  other: "Other",
};

const BOOKING_STAT_CONFIG = [
  { key: "ALL", label: "Total Bookings", Icon: BarChart3 },
  { key: "pending", label: "Pending", Icon: Zap },
  { key: "confirmed", label: "Confirmed", Icon: CheckCircle2 },
  { key: "completed", label: "Completed", Icon: Shield },
  { key: "cancelled", label: "Cancelled", Icon: MessageCircle },
];

const COMPLAINT_STAT_CONFIG = [
  { key: "ALL", label: "Total Complaints", Icon: BarChart3 },
  { key: "open", label: "Open", Icon: Zap },
  { key: "in_progress", label: "In Progress", Icon: MessageCircle },
  { key: "resolved", label: "Resolved", Icon: CheckCircle2 },
  { key: "escalated", label: "Escalated", Icon: AlertTriangle },
];

const NAV_ITEMS = [
  { Icon: LayoutDashboard, label: "Dashboard", active: true },
  { Icon: CalendarDays, label: "Bookings" },
  { Icon: BarChart3, label: "Analytics" },
  { Icon: Settings, label: "Settings" },
  { Icon: HelpCircle, label: "Help" },
];

/* ── API helpers ─────────────────────────────────────────────── */
const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function fetchTable(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
  return res.json();
}

const fetchBookings = () => fetchTable("bookings", "select=*&order=created_at.desc");
const fetchComplaints = () => fetchTable("complaints", "select=*&order=created_at.desc");
const fetchEscalations = () => fetchTable("escalations", "select=*&order=created_at.desc");
const fetchMessages = () => fetchTable("messages", "select=*&order=created_at.desc&limit=50");

async function patchRow(table, id, patch) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

/* ── Utility ─────────────────────────────────────────────────── */
function timeAgo(dateStr) {
  if (!dateStr) return "—";
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
      const eased = 1 - Math.pow(1 - t, 3);
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

function StatusPill({ config, value, onChange, disabled }) {
  const st = config[value] || Object.values(config)[0];
  return (
    <div className={`status-pill ${st.cls}`} style={{ opacity: disabled ? 0.5 : 1 }}>
      <span className="status-dot" />
      <select
        className="status-select"
        value={value || Object.keys(config)[0]}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {Object.entries(config).map(([k, v]) => (
          <option key={k} value={k}>{v.label}</option>
        ))}
      </select>
      <ChevronDown size={9} className="status-chevron" />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const [bookings, setBookings] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [selected, setSelected] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [activeTab, setActiveTab] = useState("bookings");
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("crm-theme") || "dark");

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("crm-theme", next);
  };

  const load = async () => {
    setLoading(true);
    const [b, c, e] = await Promise.all([fetchBookings(), fetchComplaints(), fetchEscalations()]);
    if (Array.isArray(b)) setBookings(b);
    if (Array.isArray(c)) setComplaints(c);
    if (Array.isArray(e)) setEscalations(e);
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

  // Reset filters when switching tabs so an old filter doesn't silently hide everything.
  useEffect(() => {
    setStatusFilter("ALL");
    setCategoryFilter("ALL");
    setSelected(null);
  }, [activeTab]);

  const statConfig = activeTab === "complaints" ? COMPLAINT_STAT_CONFIG : BOOKING_STAT_CONFIG;
  const rows = activeTab === "complaints" ? complaints : bookings;

  const statCounts = { ALL: rows.length };
  statConfig.forEach(({ key }) => {
    if (key !== "ALL") statCounts[key] = rows.filter((r) => r.status === key).length;
  });

  const filtered = rows.filter((r) => {
    const statusMatch = statusFilter === "ALL" || r.status === statusFilter;
    const categoryMatch = activeTab !== "complaints" || categoryFilter === "ALL" || r.category === categoryFilter;
    return statusMatch && categoryMatch;
  });

  const handleBookingStatusChange = async (id, newStatus) => {
    setUpdating(id);
    await patchRow("bookings", id, { status: newStatus });
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: newStatus } : b)));
    setUpdating(null);
  };

  const handleComplaintStatusChange = async (id, newStatus) => {
    setUpdating(id);
    await patchRow("complaints", id, { status: newStatus });
    setComplaints((prev) => prev.map((c) => (c.id === id ? { ...c, status: newStatus } : c)));
    setUpdating(null);
  };

  const handleResolveEscalation = async (id) => {
    setUpdating(id);
    await patchRow("escalations", id, { status: "resolved", resolved_at: new Date().toISOString() });
    setEscalations((prev) => prev.map((e) => (e.id === id ? { ...e, status: "resolved" } : e)));
    setUpdating(null);
  };

  /* ── Messages grouping ───────────────────────────────────── */
  const sessionMap = {};
  [...messages].reverse().forEach((m) => {
    if (!sessionMap[m.phone]) sessionMap[m.phone] = [];
    sessionMap[m.phone].push(m);
  });
  const sessions = Object.entries(sessionMap).sort(
    ([, a], [, b]) => new Date(b[b.length - 1].created_at) - new Date(a[a.length - 1].created_at)
  );
  const activeSession = selectedPhone ? sessionMap[selectedPhone] : null;

  const openEscalations = escalations.filter((e) => e.status === "open").length;

  const TAB_META = {
    bookings: { title: "Bookings Dashboard", sub: "Track and manage home service bookings.", Icon: LayoutDashboard },
    complaints: { title: "Complaints Dashboard", sub: "Track and resolve customer complaints.", Icon: ClipboardList },
    messages: { title: "Live Messages", sub: "All incoming WhatsApp messages in real-time.", Icon: Inbox },
    escalations: { title: "Escalations", sub: "Conversations handed off to a human agent.", Icon: AlertTriangle },
  };
  const meta = TAB_META[activeTab];

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <div data-theme={theme} className="app-shell">
      {/* ══ SIDEBAR ══════════════════════════════════════════ */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Wrench size={18} strokeWidth={2.5} />
          </div>
          <div>
            <div className="sidebar-logo-text">Home Services Bot</div>
            <div className="sidebar-logo-sub">Operations Console</div>
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
            Customers book services and file complaints directly over WhatsApp.
          </div>
          {openEscalations > 0 && (
            <button className="sidebar-footer-btn" onClick={() => setActiveTab("escalations")}>
              {openEscalations} open escalation{openEscalations > 1 ? "s" : ""}
              <ChevronRight size={13} />
            </button>
          )}
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
            <input type="text" placeholder="Search…" />
          </div>

          <div className="topbar-right">
            <button className="theme-btn" onClick={toggleTheme} title="Toggle theme">
              {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            </button>

            <button className="topbar-icon-btn" title="Notifications">
              <Bell size={15} />
              {openEscalations > 0 && <span className="notif-dot" />}
            </button>

            <button className="topbar-icon-btn" onClick={load} title="Refresh" disabled={loading}>
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
                  <meta.Icon size={18} />
                </div>
                <h1 className="page-title">{meta.title}</h1>
              </div>
              <p className="page-subtitle">{meta.sub}</p>
            </div>

            <div className="page-actions">
              <div className="tab-switcher">
                {[
                  { key: "bookings", label: "Bookings", Icon: CalendarDays },
                  { key: "complaints", label: "Complaints", Icon: ClipboardList },
                  { key: "messages", label: "Live Messages", Icon: MessageCircle, count: messages.length },
                  { key: "escalations", label: "Escalations", Icon: AlertTriangle, count: openEscalations },
                ].map(({ key, label, Icon: TabIcon, count }) => (
                  <button
                    key={key}
                    className={`tab-btn ${activeTab === key ? "active" : ""}`}
                    onClick={() => setActiveTab(key)}
                  >
                    <TabIcon size={13} />
                    {label}
                    {count > 0 && <span className="nav-badge" style={{ marginLeft: 2 }}>{count}</span>}
                  </button>
                ))}
              </div>

              {(activeTab === "bookings" || activeTab === "complaints") && (
                <button className="btn" onClick={load} disabled={loading}>
                  <span className={loading ? "spin" : ""}><RefreshCw size={13} /></span>
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              )}
            </div>
          </div>

          {/* ── Stat Cards ──────────────────────────────── */}
          {(activeTab === "bookings" || activeTab === "complaints") && (
            <div className="stats-grid">
              {statConfig.map(({ key, label, Icon: StatIcon }) => (
                <StatCard
                  key={key}
                  statKey={key}
                  label={label}
                  Icon={StatIcon}
                  count={statCounts[key] ?? 0}
                  isActive={statusFilter === key}
                  onClick={() => setStatusFilter(key)}
                />
              ))}
            </div>
          )}

          {/* ══ MESSAGES TAB ════════════════════════════════ */}
          {activeTab === "messages" && (
            <motion.div className="inbox-shell" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
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
                            <span className={`message-type-badge ${m.direction === "outbound" ? "badge-button" : "badge-text"}`}>
                              {m.direction === "outbound" ? <><Hash size={9} /> Bot</> : <><Mail size={9} /> Customer</>}
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

          {/* ══ ESCALATIONS TAB ═════════════════════════════ */}
          {activeTab === "escalations" && (
            <motion.div className="table-scroll" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              {escalations.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon-wrap"><AlertTriangle size={28} strokeWidth={1.5} /></div>
                  <div className="empty-title">No escalations</div>
                  <div className="empty-sub">Conversations handed off to a human agent will show up here.</div>
                </div>
              ) : (
                <table className="leads-table">
                  <thead>
                    <tr>{["Phone", "Reason", "Summary", "Status", "Received", ""].map((h) => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {escalations.map((e) => (
                      <tr key={e.id} className="lead-row">
                        <td><span className="cell-mono">+{e.phone}</span></td>
                        <td><span className="cell-text">{e.reason || "—"}</span></td>
                        <td><span className="cell-text">{e.conversation_summary || "—"}</span></td>
                        <td>
                          <span className={`status-pill ${e.status === "resolved" ? "s-closed" : "s-new"}`} style={{ padding: "3px 10px", fontSize: 11 }}>
                            <span className="status-dot" />
                            {e.status}
                          </span>
                        </td>
                        <td><span className="cell-muted">{timeAgo(e.created_at)}</span></td>
                        <td>
                          {e.status !== "resolved" && (
                            <button className="btn" disabled={updating === e.id} onClick={() => handleResolveEscalation(e.id)}>
                              {updating === e.id ? "…" : "Mark resolved"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </motion.div>
          )}

          {/* ══ BOOKINGS / COMPLAINTS TABS ═══════════════════ */}
          {(activeTab === "bookings" || activeTab === "complaints") && (
            <motion.div className="main-split" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div className="table-card-header">
                  <div>
                    <div className="table-card-title">{activeTab === "complaints" ? "All Complaints" : "All Bookings"}</div>
                    <div className="table-card-sub">
                      <Users size={11} />
                      {filtered.length} {filtered.length === 1 ? "record" : "records"}
                    </div>
                  </div>
                  {activeTab === "complaints" && (
                    <div className="filter-chips">
                      {[{ key: "ALL", label: "All" }, ...Object.entries(COMPLAINT_CATEGORY_LABELS).map(([k, label]) => ({ key: k, label }))].map(({ key, label }) => (
                        <button key={key} className={`chip ${categoryFilter === key ? "active" : ""}`} onClick={() => setCategoryFilter(key)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="table-scroll">
                  {loading ? (
                    <div className="empty-state">
                      <div className="loading-spinner"><RefreshCw size={28} strokeWidth={1.5} /></div>
                      <div className="empty-title" style={{ marginTop: 10 }}>Loading…</div>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon-wrap"><Users size={28} strokeWidth={1.5} /></div>
                      <div className="empty-title">Nothing here yet</div>
                      <div className="empty-sub">Try adjusting your filters above</div>
                    </div>
                  ) : activeTab === "bookings" ? (
                    <table className="leads-table">
                      <thead>
                        <tr>{["Reference", "Date", "Time", "Price", "Status", "Received"].map((h) => <th key={h}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {filtered.map((b, i) => (
                          <motion.tr
                            key={b.id}
                            className={`lead-row ${selected?.id === b.id ? "selected" : ""}`}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, delay: Math.min(i * 0.012, 0.25) }}
                            onClick={() => setSelected(selected?.id === b.id ? null : b)}
                          >
                            <td><span className="cell-mono">{b.reference}</span></td>
                            <td><span className="cell-mono">{b.scheduled_date || "—"}</span></td>
                            <td><span className="cell-mono">{b.scheduled_time || "—"}</span></td>
                            <td><span className="cell-text">{b.price ? `AED ${b.price}` : "—"}</span></td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <StatusPill config={BOOKING_STATUS_CONFIG} value={b.status} disabled={updating === b.id} onChange={(v) => handleBookingStatusChange(b.id, v)} />
                            </td>
                            <td><span className="cell-muted">{timeAgo(b.created_at)}</span></td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="leads-table">
                      <thead>
                        <tr>{["Reference", "Category", "Description", "Status", "Received"].map((h) => <th key={h}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {filtered.map((c, i) => (
                          <motion.tr
                            key={c.id}
                            className={`lead-row ${selected?.id === c.id ? "selected" : ""}`}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, delay: Math.min(i * 0.012, 0.25) }}
                            onClick={() => setSelected(selected?.id === c.id ? null : c)}
                          >
                            <td><span className="cell-mono">{c.reference}</span></td>
                            <td><span className="biz-chip">{COMPLAINT_CATEGORY_LABELS[c.category] || c.category}</span></td>
                            <td><span className="cell-text">{c.description || "—"}</span></td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <StatusPill config={COMPLAINT_STATUS_CONFIG} value={c.status} disabled={updating === c.id} onChange={(v) => handleComplaintStatusChange(c.id, v)} />
                            </td>
                            <td><span className="cell-muted">{timeAgo(c.created_at)}</span></td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* ── Detail Panel ──────────────────────────── */}
              <AnimatePresence>
                {selected && (
                  <motion.aside
                    key={selected.id}
                    className="detail-panel"
                    initial={{ opacity: 0, x: 24, width: 0 }}
                    animate={{ opacity: 1, x: 0, width: 300 }}
                    exit={{ opacity: 0, x: 24, width: 0 }}
                    transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
                  >
                    <div>
                      <div className="detail-eyebrow">
                        <Tag size={10} />
                        {activeTab === "complaints" ? "Complaint Details" : "Booking Details"}
                      </div>
                      <div className="detail-name">{selected.reference}</div>
                    </div>

                    <div className="detail-card">
                      <div className="detail-row">
                        <div className="detail-row-icon"><Activity size={13} /></div>
                        <div>
                          <div className="detail-row-label">Status</div>
                          <div style={{ marginTop: 4 }}>
                            {activeTab === "complaints" ? (
                              <span className={`status-pill ${COMPLAINT_STATUS_CONFIG[selected.status]?.cls || "s-new"}`} style={{ padding: "3px 10px", fontSize: 11 }}>
                                <span className="status-dot" />
                                {COMPLAINT_STATUS_CONFIG[selected.status]?.label || selected.status}
                              </span>
                            ) : (
                              <span className={`status-pill ${BOOKING_STATUS_CONFIG[selected.status]?.cls || "s-new"}`} style={{ padding: "3px 10px", fontSize: 11 }}>
                                <span className="status-dot" />
                                {BOOKING_STATUS_CONFIG[selected.status]?.label || selected.status}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {activeTab === "bookings" && (
                        <div className="detail-row">
                          <div className="detail-row-icon"><CalendarDays size={13} /></div>
                          <div>
                            <div className="detail-row-label">Scheduled</div>
                            <div className="detail-row-value">{selected.scheduled_date} {selected.scheduled_time}</div>
                          </div>
                        </div>
                      )}
                      {activeTab === "complaints" && (
                        <div className="detail-row">
                          <div className="detail-row-icon"><Building2 size={13} /></div>
                          <div>
                            <div className="detail-row-label">Category</div>
                            <div className="detail-row-value">{COMPLAINT_CATEGORY_LABELS[selected.category] || selected.category}</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {selected.description && (
                      <div className="detail-card">
                        <div className="detail-section-label">Description</div>
                        <div className="detail-section-body">{selected.description}</div>
                      </div>
                    )}
                    {selected.notes && (
                      <div className="detail-card">
                        <div className="detail-section-label">Notes</div>
                        <div className="detail-section-body">{selected.notes}</div>
                      </div>
                    )}

                    <div className="detail-footer">
                      <Clock size={11} />
                      Received {timeAgo(selected.created_at)}
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
