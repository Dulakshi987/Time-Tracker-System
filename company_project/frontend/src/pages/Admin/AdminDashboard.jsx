import { useState, useEffect, useCallback } from "react";
import "./AdminDashboard.css";

const API = "http://localhost:8080/api";
const AUTO_REFRESH = 30000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2,"0")}s`;
  return `${s}s`;
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function useDashboardData(dateFilter) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetch_data = useCallback(async () => {
    setError(null);
    try {
      // Fetch all documents from the document portal
      const res  = await fetch(`${API}/documents`);
      if (!res.ok) throw new Error("Failed to fetch documents");
      const docs = await res.json();

      // Apply date filter
      let filtered = docs;
      if (dateFilter.from) {
        filtered = filtered.filter(d => d.requestDate >= dateFilter.from);
      }
      if (dateFilter.to) {
        filtered = filtered.filter(d => d.requestDate <= dateFilter.to);
      }

      setData(process(filtered));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [dateFilter]);

  useEffect(() => { fetch_data(); }, [fetch_data]);
  useEffect(() => {
    const id = setInterval(fetch_data, AUTO_REFRESH);
    return () => clearInterval(id);
  }, [fetch_data]);

  return { data, loading, error, refresh: fetch_data };
}

function process(docs) {
  // ── Job type breakdown ──────────────────────────────────────────────
  const jobTypes = {};
  docs.forEach(d => {
    const jt = d.jobType || "Other";
    jobTypes[jt] = (jobTypes[jt] || 0) + 1;
  });

  // ── Status counts ───────────────────────────────────────────────────
  const printStatus   = countStatus(docs, "printStatus");
  const pickStatus    = countStatus(docs, "status");        // pick portal uses 'status'
  const checkStatus   = countStatus(docs, "checkStatus");
  const deliveryStatus= countStatus(docs, "deliveryStatus");

  // ── System efficiency (Print portal) ───────────────────────────────
  const printDone  = docs.filter(d => d.printStatus === "COMPLETED");
  const systemEff  = buildEfficiency(printDone, "printedBy", "printDurationSeconds");

  // ── Picking efficiency ──────────────────────────────────────────────
  const pickDone = docs.filter(d =>
    (d.status || "").toUpperCase() === "COMPLETED"
  );
  const pickEff = buildEfficiency(pickDone, "pickedBy", "durationSeconds");

  // ── Checking efficiency ─────────────────────────────────────────────
  const checkDone = docs.filter(d => d.checkStatus === "COMPLETED");
  const checkEff  = buildEfficiency(checkDone, "checkedBy", "checkDurationSeconds");

  // ── Delivery summary ────────────────────────────────────────────────
  const totalDeliveryPool = docs.filter(d => d.checkStatus === "COMPLETED").length;
  const deliveredDone     = docs.filter(d => d.deliveryStatus === "COMPLETED").length;
  const deliveryCancelled = docs.filter(d => (d.deliveryStatus||"").toUpperCase() === "CANCELLED").length;

  // ── Document summary ────────────────────────────────────────────────
  const docPool      = docs.length;
  const docCompleted = docs.filter(d => d.deliveryStatus === "COMPLETED").length;

  return {
    total: docs.length,
    jobTypes,
    printStatus,
    pickStatus,
    checkStatus,
    deliveryStatus,
    systemEff,
    pickEff,
    checkEff,
    totalDeliveryPool,
    deliveredDone,
    deliveryCancelled,
    docPool,
    docCompleted,
    // issued per day summary
    issuedTotal:    docs.length,
    issuedOngoing:  docs.filter(d => {
      const s = (d.status || "").toUpperCase();
      return s === "IN_PROGRESS" || s === "ON_HOLD";
    }).length,
    issuedComplete: docs.filter(d => (d.status||"").toUpperCase() === "COMPLETED").length,
    // pick summary
    pickTotal:      docs.length,
    pickOngoing:    docs.filter(d => ["IN_PROGRESS","ON_HOLD"].includes((d.status||"").toUpperCase())).length,
    pickComplete:   pickDone.length,
    // check summary
    checkTotal:     docs.length,
    checkOngoing:   docs.filter(d => ["IN_PROGRESS","ON_HOLD"].includes((d.checkStatus||"").toUpperCase())).length,
    checkComplete:  checkDone.length,
  };
}

function countStatus(docs, field) {
  const out = { PENDING:0, IN_PROGRESS:0, ON_HOLD:0, COMPLETED:0, CANCELLED:0, total:0 };
  docs.forEach(d => {
    const s = (d[field] || "PENDING").toUpperCase().replace(/\s+/g,"_");
    out[s] = (out[s] || 0) + 1;
    out.total++;
  });
  return out;
}

function buildEfficiency(done, nameField, durField) {
  const people = {};
  done.forEach(d => {
    const name = d[nameField] || "Unknown";
    if (!people[name]) people[name] = { name, count:0, totalSec:0 };
    people[name].count++;
    people[name].totalSec += d[durField] || 0;
  });
  return Object.values(people)
    .map(p => ({
      name:     p.name,
      jobsPerDay: p.count,               // simplified (you can divide by unique days)
      avgTime:  p.count > 0 ? Math.round(p.totalSec / p.count) : 0,
      totalTime: p.totalSec,
    }))
    .sort((a, b) => b.jobsPerDay - a.jobsPerDay);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }) {
  return (
    <div className="ad-summary-card">
      <div className="ad-sc-label">{label}</div>
      <div className="ad-sc-value" style={{ borderBottom: `3px solid ${color}` }}>{value}</div>
    </div>
  );
}

function JobTypeBar({ jobTypes, total }) {
  const COLORS = {
    Balance:       "#a78bfa",
    Domestic:      "#34d399",
    "Cost Center": "#f59e0b",
    Commercial:    "#3b82f6",
    "Sales Order": "#f472b6",
  };

  return (
    <div className="ad-jobtype-row">
      {Object.entries(jobTypes).map(([jt, count]) => (
        <div key={jt} className="ad-jt-chip">
          <div className="ad-jt-name">{jt}</div>
          <div className="ad-jt-val" style={{ color: COLORS[jt] || "#7c8db0" }}>{count}</div>
        </div>
      ))}
    </div>
  );
}

function EfficiencyTable({ title, rows, emptyMsg }) {
  return (
    <div className="ad-eff-box">
      <div className="ad-eff-title">{title}</div>
      {rows.length === 0 ? (
        <div className="ad-eff-empty">{emptyMsg || "No completed records"}</div>
      ) : (
        <table className="ad-eff-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Jobs done</th>
              <th>Avg time</th>
              <th>Total time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td>{r.jobsPerDay}</td>
                <td>{formatDuration(r.avgTime)}</td>
                <td>{formatDuration(r.totalTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatRow({ label, total, ongoing, complete }) {
  return (
    <div className="ad-stat-row">
      <div className="ad-stat-title">{label}</div>
      <div className="ad-stat-cols">
        <div className="ad-stat-col">
          <div className="ad-stat-hdr">Total</div>
          <div className="ad-stat-num">{total}</div>
        </div>
        <div className="ad-stat-col">
          <div className="ad-stat-hdr">Ongoing</div>
          <div className="ad-stat-num amber">{ongoing}</div>
        </div>
        <div className="ad-stat-col">
          <div className="ad-stat-hdr">Completed</div>
          <div className="ad-stat-num green">{complete}</div>
        </div>
      </div>
    </div>
  );
}

function DeliveryStatRow({ label, pool, completed, cancelled }) {
  return (
    <div className="ad-stat-row">
      <div className="ad-stat-title">{label}</div>
      <div className="ad-stat-cols">
        <div className="ad-stat-col">
          <div className="ad-stat-hdr">Pool</div>
          <div className="ad-stat-num">{pool}</div>
        </div>
        <div className="ad-stat-col">
          <div className="ad-stat-hdr">Completed</div>
          <div className="ad-stat-num green">{completed}</div>
        </div>
        {cancelled !== undefined && (
          <div className="ad-stat-col">
            <div className="ad-stat-hdr">Cancelled</div>
            <div className="ad-stat-num red">{cancelled}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Date Range Filter ─────────────────────────────────────────────────────────

const PRESETS = [
  { label: "Today",  days: 0 },
  { label: "7 Days", days: 7 },
  { label: "30 Days",days: 30 },
  { label: "Year",   days: 365 },
];

function DateBar({ filter, onFilter }) {
  const [preset, setPreset] = useState(null);
  const [from, setFrom]     = useState(filter.from || "");
  const [to, setTo]         = useState(filter.to || "");

  const applyPreset = (days) => {
    setPreset(days);
    if (days === 0) {
      const today = new Date().toISOString().slice(0,10);
      onFilter({ from: today, to: today });
      setFrom(today); setTo(today);
    } else {
      const t = new Date().toISOString().slice(0,10);
      const f = new Date(Date.now() - days * 86400000).toISOString().slice(0,10);
      onFilter({ from: f, to: t });
      setFrom(f); setTo(t);
    }
  };

  const applyCustom = () => { setPreset("custom"); onFilter({ from, to }); };
  const clearAll    = () => { setPreset(null); setFrom(""); setTo(""); onFilter({ from:"", to:"" }); };

  return (
    <div className="ad-datebar">
      {PRESETS.map(p => (
        <button key={p.label}
          className={`ad-preset-btn ${preset === p.days ? "active" : ""}`}
          onClick={() => applyPreset(p.days)}
        >{p.label}</button>
      ))}
      <button className={`ad-preset-btn ${preset === "custom" ? "active" : ""}`}>Custom</button>
      <input type="date" className="ad-date-input" value={from}
        onChange={e => setFrom(e.target.value)} />
      <span style={{ color:"#7c8db0" }}>—</span>
      <input type="date" className="ad-date-input" value={to}
        onChange={e => setTo(e.target.value)} />
      <button className="ad-apply-btn" onClick={applyCustom}>Apply</button>
      {(from || to) && (
        <button className="ad-clear-btn" onClick={clearAll}>Clear</button>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [dateFilter, setDateFilter] = useState({ from:"", to:"" });
  const { data, loading, error, refresh } = useDashboardData(dateFilter);

  return (
    <div className="ad-page">
      {/* ── Top bar ── */}
      <div className="ad-topbar">
        <div className="ad-logo">
          <span className="ad-logo-badge">WMS</span>
          <span className="ad-logo-title">Fentons Operation Efficiency Dashboard</span>
        </div>
        <button className="ad-refresh-btn" onClick={refresh}>↻ Refresh</button>
      </div>

      {/* ── Date bar ── */}
      <DateBar filter={dateFilter} onFilter={setDateFilter} />

      {/* ── Loading / Error ── */}
      {error && (
        <div className="ad-error">⚠ {error} — <button onClick={refresh}>retry</button></div>
      )}

      {loading && !data ? (
        <div className="ad-loading">
          {[1,2,3,4].map(i => <div key={i} className="ad-skeleton" />)}
        </div>
      ) : data ? (
        <>
          {/* ══ Row 1: Summary numbers ══ */}
          <div className="ad-section-title">Summary</div>
          <div className="ad-summary-row">
            <SummaryCard label="Total Jobs"    value={data.total}             color="#3b82f6" />
            <SummaryCard label="Print"         value={data.printStatus.COMPLETED || 0} color="#a78bfa" />
            <SummaryCard label="Pick"          value={data.pickComplete}      color="#34d399" />
            <SummaryCard label="Check"         value={data.checkComplete}     color="#f59e0b" />
            <SummaryCard label="Dispatch"      value={data.deliveredDone}     color="#22c55e" />
            <SummaryCard label="Documentation" value={data.docPool}           color="#f472b6" />
          </div>

          {/* ══ Row 2: Job types ══ */}
          {Object.keys(data.jobTypes).length > 0 && (
            <>
              <div className="ad-section-title">Job Types</div>
              <JobTypeBar jobTypes={data.jobTypes} total={data.total} />
            </>
          )}

          {/* ══ Row 3: Two column layout ══ */}
          <div className="ad-two-col">

            {/* LEFT: Efficiency tables */}
            <div className="ad-col">
              <div className="ad-section-title">System Efficiency (Print)</div>
              <EfficiencyTable title="System efficiency" rows={data.systemEff} />

              <div className="ad-section-title" style={{ marginTop:20 }}>Picking Efficiency</div>
              <EfficiencyTable title="Picking efficiency" rows={data.pickEff} />

              <div className="ad-section-title" style={{ marginTop:20 }}>Checking Efficiency</div>
              <EfficiencyTable title="Checking efficiency" rows={data.checkEff} />
            </div>

            {/* RIGHT: Stats */}
            <div className="ad-col">
              <div className="ad-section-title">Total Jobs Issued Per Day</div>
              <div className="ad-stats-box">
                <StatRow
                  label="Documents Issued"
                  total={data.issuedTotal}
                  ongoing={data.issuedOngoing}
                  complete={data.issuedComplete}
                />
                <StatRow
                  label="Total Jobs Pick"
                  total={data.pickTotal}
                  ongoing={data.pickOngoing}
                  complete={data.pickComplete}
                />
                <StatRow
                  label="Total Jobs Check"
                  total={data.checkTotal}
                  ongoing={data.checkOngoing}
                  complete={data.checkComplete}
                />
              </div>

              <div className="ad-section-title" style={{ marginTop:20 }}>Delivery & Document</div>
              <div className="ad-stats-box">
                <DeliveryStatRow
                  label="Total Jobs Delivered"
                  pool={data.totalDeliveryPool}
                  completed={data.deliveredDone}
                  cancelled={data.deliveryCancelled}
                />
                <DeliveryStatRow
                  label="Document"
                  pool={data.docPool}
                  completed={data.docCompleted}
                />
              </div>
            </div>

          </div>
        </>
      ) : null}
    </div>
  );
}
