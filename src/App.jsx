import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import "./App.css";

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
      background: "var(--color-surface-primary)",
      color: "var(--color-text-primary)",
      fontFamily: "var(--font-body)",
      display: "flex",
      flexDirection: "column",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--color-surface-tertiary); border-radius: 4px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .lead-row { transition: background 0.15s; cursor: pointer; }
        .lead-row:hover { background: rgba(255, 255, 255, 0.03) !important; }
        .filter-btn { transition: all 0.15s; border: none; cursor: pointer; font-family: inherit; }
        .filter-btn:hover { opacity: 0.85; }
        .status-select { background: transparent; border: none; font-family: 'DM Mono', monospace; font-size: 11px; cursor: pointer; outline: none; }
        .refresh-btn { transition: opacity 0.15s; }
        .refresh-btn:hover { opacity: 0.7; }
        .detail-panel { animation: fadeIn 0.2s ease; }
      `}</style>

      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          borderBottom: '1px solid var(--color-border)',
          padding: '18px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(15, 23, 42, 0.8)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, var(--color-brand), var(--color-accent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16,
          }}>💬</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em' }}>WhatsApp CRM</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: "'DM Mono', monospace" }}>
              {leads.length} total leads · refreshed {timeAgo(lastRefresh)}
            </div>
          </div>
        </div>
        <button className="refresh-btn" onClick={load} style={{
          background: 'rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--color-border)',
          borderRadius: 8, padding: '7px 14px',
          color: 'var(--color-text-primary)', fontSize: 12, cursor: 'pointer',
          fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ display: 'inline-block', animation: loading ? 'spin 0.8s linear infinite' : 'none' }}>↻</span>
          Refresh
        </button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        style={{ display: 'flex', gap: 1, borderBottom: '1px solid var(--color-border)', background: 'rgba(10, 10, 12, 0.5)' }}
      >
        {[{ key: 'ALL', label: 'All leads', emoji: '📊' }, ...Object.entries(BIZ_CONFIG).map(([k,v]) => ({ key: k, label: v.label, emoji: v.emoji }))].map(({ key, label, emoji }) => (
          <button key={key} className="filter-btn" onClick={() => setFilter(key)} style={{
            flex: 1, padding: '14px 8px', textAlign: 'center',
            background: filter === key ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
            color: filter === key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            borderTop: filter === key ? '2px solid var(--color-brand)' : '2px solid transparent',
            fontSize: 12,
          }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{emoji}</div>
            <div style={{ fontWeight: 600, fontSize: 20, fontFamily: "'DM Mono', monospace" }}>
              {key === 'ALL' ? counts.ALL : (counts[key] || 0)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>{label}</div>
          </button>
        ))}
      </motion.div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 0 40px' }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            style={{ display: 'flex', gap: 8, padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}
          >
            {['ALL', ...Object.keys(STATUS_CONFIG)].map(s => {
              const cfg = STATUS_CONFIG[s];
              const active = statusFilter === s;
              return (
                <button key={s} className="filter-btn" onClick={() => setStatusFilter(s)} style={{
                  padding: '4px 12px', borderRadius: 20,
                  background: active ? (cfg?.bg + '22') : 'rgba(255, 255, 255, 0.05)',
                  color: active ? (cfg?.text || 'var(--color-text-primary)') : 'var(--color-text-muted)',
                  fontSize: 11, fontWeight: 500,
                }}>
                  {s === 'ALL' ? 'All statuses' : cfg.label}
                </button>
              );
            })}
          </motion.div>

          {loading ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}
            >
              <div style={{ fontSize: 24, animation: 'spin 1s linear infinite', display: 'inline-block' }}>↻</div>
              <div style={{ marginTop: 8, fontSize: 12 }}>Loading leads...</div>
            </motion.div>
          ) : filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}
            >
              <div style={{ fontSize: 32 }}>📭</div>
              <div style={{ marginTop: 8, fontSize: 13 }}>No leads found</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>Try a different filter</div>
            </motion.div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Business', 'Name', 'Phone', 'Service / Intent', 'Date', 'Status', 'Received'].map(h => (
                    <th key={h} style={{
                      padding: '10px 16px', textAlign: 'left',
                      fontSize: 10, fontWeight: 500, color: 'var(--color-text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      fontFamily: "'DM Mono', monospace",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead, i) => {
                  const biz = BIZ_CONFIG[lead.business_type] || { emoji: '❓', label: lead.business_type, bg: '#1a1a1f', text: '#888' };
                  const st = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
                  const isSelected = selected?.id === lead.id;
                  return (
                    <motion.tr
                      key={lead.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: i * 0.03 }}
                      className="lead-row"
                      onClick={() => setSelected(isSelected ? null : lead)}
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        background: isSelected ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '3px 10px', borderRadius: 6,
                          background: biz.bg + '22', color: biz.text,
                          fontSize: 11, fontWeight: 500,
                        }}>
                          <span style={{ fontSize: 13 }}>{biz.emoji}</span>
                          {biz.label}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500 }}>
                        {lead.name || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--color-text-muted)' }}>
                        +{lead.phone}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {lead.service || lead.intent || '—'}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--color-text-muted)' }}>
                        {lead.booking_date || '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }} onClick={e => e.stopPropagation()}>
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '3px 10px', borderRadius: 6,
                          background: st.bg + '33',
                        }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot }} />
                          <select
                            className="status-select"
                            value={lead.status || 'new'}
                            style={{ color: st.text, opacity: updating === lead.id ? 0.5 : 1 }}
                            onChange={e => handleStatusChange(lead.id, e.target.value)}
                            disabled={updating === lead.id}
                          >
                            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                              <option key={k} value={k} style={{ background: 'var(--color-surface-primary)', color: 'var(--color-text-primary)' }}>{v.label}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 11, color: 'var(--color-text-muted)', fontFamily: "'DM Mono', monospace" }}>
                        {timeAgo(lead.created_at)}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {selectedLead && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="detail-panel"
            style={{
              width: 300, borderLeft: '1px solid var(--color-border)',
              background: 'rgba(10, 10, 12, 0.5)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              padding: 20, overflow: 'auto',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: "'DM Mono', monospace", marginBottom: 4 }}>
                Lead Details
              </div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{selectedLead.name || 'Unnamed Lead'}</div>
            </div>

            <div className="glass" style={{ padding: 16, borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(37, 211, 102, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, color: '#25D366' }}>📞</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: "'DM Mono', monospace" }}>Phone</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>+{selectedLead.phone}</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(99, 102, 241, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-brand)' }}>🏢</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: "'DM Mono', monospace" }}>Business Type</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {BIZ_CONFIG[selectedLead.business_type]?.label || selectedLead.business_type}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(20, 184, 166, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-accent)' }}>📅</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: "'DM Mono', monospace" }}>Status</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {STATUS_CONFIG[selectedLead.status]?.label || selectedLead.status}
                  </div>
                </div>
              </div>
            </div>

            {selectedLead.service || selectedLead.intent ? (
              <div className="glass" style={{ padding: 16, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>
                  Service / Intent
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {selectedLead.service || selectedLead.intent}
                </div>
              </div>
            ) : null}

            {selectedLead.booking_date ? (
              <div className="glass" style={{ padding: 16, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>
                  Booking Date
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {selectedLead.booking_date}
                </div>
              </div>
            ) : null}

            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: "'DM Mono', monospace", textAlign: 'center' }}>
              Received {timeAgo(selectedLead.created_at)}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}