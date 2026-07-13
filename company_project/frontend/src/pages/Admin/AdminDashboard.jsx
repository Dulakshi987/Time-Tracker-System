import { useState, useEffect, useCallback, useMemo } from "react";
import "./AdminDashboard.css";
import * as XLSX from "xlsx";

// ── Portal pages (rendered inline when their sidebar item is selected) ─────
import IssuePrintForm    from "../Issue_Print_Portal/IssuePrintForm";
import IssuPrint         from "../Issue_Pick_Portal/IssuePickForm";
import IssueCheckForm    from "../Issue_Check_Portal/IssueCheckForm";
import IssueDeliveryForm from "../Issue_Delivery_Portal/IssueDeliveryForm";
import ConfirmPortal     from "../Confirm_Portal/ConfirmPortal";

// ── Config ───────────────────────────────────────────────────────────────
const MASTER_API   = "http://localhost:8080/api/print-portal";
const AUTO_REFRESH = 1000;
const CONFIG_KEY    = "admin_job_types_config";

const DEFAULT_JOB_TYPES = [
  "Balance", "Domestic", "Cost Center", "Commercial", "Sales Order",
];

function loadJobTypes() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (e) { /* ignore */ }
  return DEFAULT_JOB_TYPES;
}
function saveJobTypes(list) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(list));
}

// ── Generic helpers ──────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }

// FIX: previously this rounded down to whole minutes, so any duration under
// 60 seconds (very common for Pick/Check jobs) always displayed as "0:00".
// Now it always shows seconds, and adds hours when the duration is long enough.
function secondsToHMS(totalSeconds) {
  if (!totalSeconds || totalSeconds <= 0) return "0:00";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

function toDateKey(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// FIX: date-range filtering (Today / 7 Days / 30 Days / Year / Custom) must be
// based on requestDate — not createdDatetime. createdDatetime is when the row
// was first inserted into the system (often far earlier than the actual job
// date), so using it made the range filters look "broken" / show nothing.
// requestDate is checked first now, and createdDatetime is only a fallback
// for the rare row that has no requestDate at all.
// Uses whichever of requestDate / createdDatetime is MORE RECENT as the
// document's "activity date" for Today/7D/30D/Year filtering.
// Why: requestDate is entered manually and can be old/incorrect, while
// createdDatetime is a real system timestamp. If we only trusted requestDate,
// a document touched today but requested weeks ago would vanish from "Today" —
// which is exactly what was happening. Taking the max of the two means a
// document shows up in short-range filters if EITHER date is recent.
// Dashboard-level date filtering (Today/7D/30D/Year/Custom) uses ONLY the
// requestDate — i.e. the date the document was entered. Per-stage dates
// (print/pick/check/delivery start & hold times) are filtered separately,
// inside the Full Report panel below — see STAGE_DATE_FIELDS.
function docDateKey(doc) {
  return toDateKey(doc.requestDate);
}

// ── Status classifiers (mirror each portal's own logic) ─────────────────

function printStatusClass(s) {
  const v = (s || "").toLowerCase();
  if (v.includes("cancel")) return "cancelled";
  if (v.includes("complete") || v.includes("done")) return "completed";
  if (v.includes("hold")) return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("handed")) return "handedover";
  return "pending";
}
function pickStatusClass(s) {
  const v = (s || "").toLowerCase();
  if (v.includes("hold")) return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("complete") || v.includes("done")) return "completed";
  return "pending";
}
function checkStatusClass(s) { return pickStatusClass(s); }
function deliveryStatusClass(s) {
  const v = (s || "").toLowerCase();
  if (v.includes("cancel")) return "cancelled";
  if (v.includes("hold")) return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("complete") || v.includes("done")) return "completed";
  return "pending";
}

// ── Date range filter ─────────────────────────────────────────────────────

function inRange(doc, range, fromDate, toDate) {
  const key = docDateKey(doc);
  if (range === "ALL") return true;
  if (!key) return false; // no date on doc -> exclude from date-scoped views

  const now = new Date();
  const todayKey = toDateKey(now);

  switch (range) {
    case "TODAY":
      return key === todayKey;
    case "7D": {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return key >= toDateKey(from) && key <= todayKey;
    }
    case "30D": {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      return key >= toDateKey(from) && key <= todayKey;
    }
    case "YEAR":
      return key.slice(0, 4) === String(now.getFullYear());
    case "CUSTOM":
      if (!fromDate && !toDate) return true;
      if (fromDate && key < fromDate) return false;
      if (toDate && key > toDate) return false;
      return true;
    default:
      return true;
  }
}

// ── Operator filter ───────────────────────────────────────────────────────

function docOperators(doc) {
  return [
    doc.requestedBy, doc.enteredBy, doc.printedBy, doc.PrintHandedOverBy,
    doc.printHandedOverBy, doc.pickedBy, doc.checkedBy, doc.deliveredBy,
  ].filter(Boolean);
}

// ── Aggregation ────────────────────────────────────────────────────────────

function portalCounts(docs, eligibleFn, statusFn) {
  const eligible = docs.filter(eligibleFn);
  const total = eligible.length;
  const completed = eligible.filter(d => statusFn(d) === "completed").length;
  const cancelled = eligible.filter(d => statusFn(d) === "cancelled").length;
  const ongoing = total - completed - cancelled;
  return { total, ongoing, completed, cancelled };
}

function operatorEfficiency(docs, byField, durationField, doneFn) {
  const groups = {};
  docs.forEach(d => {
    if (!doneFn(d)) return;
    const name = d[byField];
    if (!name) return;
    if (!groups[name]) groups[name] = { jobs: 0, totalSeconds: 0 };
    groups[name].jobs += 1;
    groups[name].totalSeconds += Number(d[durationField]) || 0;
  });
  return Object.entries(groups)
    .map(([name, v]) => ({
      name,
      jobs: v.jobs,
      totalSeconds: v.totalSeconds,
      avgSeconds: v.jobs ? Math.round(v.totalSeconds / v.jobs) : 0,
    }))
    .sort((a, b) => b.jobs - a.jobs);
}

// ── Small UI atoms ─────────────────────────────────────────────────────────

function KpiCard({ label, value, colorClass }) {
  return (
    <div className="adm-kpi-card">
      <div className="adm-kpi-label">{label}</div>
      <div className={`adm-kpi-value ${colorClass || ""}`}>{value}</div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div className="adm-section-title">{children}</div>;
}

function TripleStat({ title, total, ongoing, completed, cancelled }) {
  return (
    <div className="adm-triple-card">
      <div className="adm-triple-title">{title}</div>
      <div className="adm-triple-stats">
        <div><div className="adm-stat-label">Total</div><div className="adm-stat-value">{total}</div></div>
        <div><div className="adm-stat-label">Ongoing</div><div className="adm-stat-value ongoing">{ongoing}</div></div>
        <div><div className="adm-stat-label">Completed</div><div className="adm-stat-value completed">{completed}</div></div>
        {cancelled !== undefined && (
          <div><div className="adm-stat-label">Cancelled</div><div className="adm-stat-value cancelled">{cancelled}</div></div>
        )}
      </div>
    </div>
  );
}

function EfficiencyTable({ title, rows }) {
  return (
    <div className="adm-eff-card">
      <div className="adm-eff-title">{title}</div>
      <table className="adm-eff-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Jobs</th>
            <th>Avg Time</th>
            <th>Total Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={4} className="adm-eff-empty">No data yet</td></tr>
          ) : rows.map(r => (
            <tr key={r.name}>
              <td>👤 {r.name}</td>
              <td>{r.jobs}</td>
              <td>{secondsToHMS(r.avgSeconds)}</td>
              <td>{secondsToHMS(r.totalSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
// ── Live duration engine (per-second, matches backend's start→hold / resume→end logic) ──

const STAGE_CONFIG = {
  print: {
    statusField: "printStatus", startField: "printStartTime",
    holdField: "printHoldTime", totalHoldField: "printTotalHoldSeconds",
    durationField: "printDurationSeconds",
  },
  pick: {
    statusField: "status", startField: "startTime",
    holdField: "holdTime", totalHoldField: "totalHoldSeconds",
    durationField: "durationSeconds",
  },
  check: {
    statusField: "checkStatus", startField: "checkStartTime",
    holdField: "checkHoldTime", totalHoldField: "checkTotalHoldSeconds",
    durationField: "checkDurationSeconds",
  },
  delivery: {
    statusField: "deliveryStatus", startField: "deliveryStartTime",
    holdField: "deliveryHoldTime", totalHoldField: "deliveryTotalHoldSeconds",
    durationField: "deliveryDurationSeconds",
  },
};

// Mirrors the backend: total = (elapsed since start) - (accumulated hold seconds).
// While ON_HOLD, time is frozen at the point the hold started (doesn't keep ticking).
// While IN_PROGRESS, it ticks live using `nowMs`.
function liveDurationSeconds(doc, stage, nowMs) {
  const cfg = STAGE_CONFIG[stage];
  const status = (doc[cfg.statusField] || "").toLowerCase();
  const totalHold = doc[cfg.totalHoldField] || 0;

  if (status.includes("complete") || status.includes("done")) {
    return doc[cfg.durationField] || 0;
  }
  if (!doc[cfg.startField]) return 0;

  const start = new Date(doc[cfg.startField]).getTime();

  if (status.includes("hold")) {
    const holdStart = doc[cfg.holdField] ? new Date(doc[cfg.holdField]).getTime() : nowMs;
    return Math.max((holdStart - start) / 1000 - totalHold, 0);
  }
  // in progress / resumed
  return Math.max((nowMs - start) / 1000 - totalHold, 0);
}

function LiveJobsPanel({ documents, nowMs }) {
  const stages = [
    { key: "print", label: "🖨️ Print", statusField: "printStatus" },
    { key: "pick", label: "📦 Pick", statusField: "status" },
    { key: "check", label: "✅ Check", statusField: "checkStatus" },
    { key: "delivery", label: "🚚 Delivery", statusField: "deliveryStatus" },
  ];

  return (
    <div className="adm-eff-row">
      {stages.map(s => {
        const running = documents.filter(d => {
          const v = (d[s.statusField] || "").toLowerCase();
          return v.includes("progress") || v.includes("hold");
        });
        return (
          <div key={s.key} className="adm-eff-card">
            <div className="adm-eff-title">{s.label} — Live ({running.length})</div>
            <table className="adm-eff-table">
              <thead><tr><th>Doc</th><th>Status</th><th>Elapsed</th></tr></thead>
              <tbody>
                {running.length === 0 ? (
                  <tr><td colSpan={3} className="adm-eff-empty">No active jobs</td></tr>
                ) : running.map(d => {
                  const secs = liveDurationSeconds(d, s.key, nowMs);
                  const onHold = (d[s.statusField] || "").toLowerCase().includes("hold");
                  return (
                    <tr key={d.id}>
                      <td>{d.printDocumentNo || d.id}</td>
                      <td><StatusBadge status={d[s.statusField]} /></td>
                      <td className={onHold ? "" : "adm-live-ticking"}>{secondsToHMS(secs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}


function StatusBadge({ status }) {
  const v = (status || "pending").toLowerCase();
  let cls = "pending";
  if (v.includes("cancel")) cls = "cancelled";
  else if (v.includes("complete") || v.includes("done")) cls = "completed";
  else if (v.includes("hold")) cls = "onhold";
  else if (v.includes("handed")) cls = "handedover";
  else if (v.includes("progress")) cls = "inprogress";
  return <span className={`adm-badge ${cls}`}>{status || "Pending"}</span>;
}


// Hook: ticks once per second, returns current epoch ms
function useTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
// ── Sidebar ──────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard",       icon: "📊" },
  { key: "print",     label: "Print Portal",    icon: "🖨️" },
  { key: "pick",      label: "Picking Portal",  icon: "📦" },
  { key: "check",     label: "Checking Portal", icon: "✅" },
  { key: "delivery",  label: "Delivery Portal", icon: "🚚" },
  { key: "document",  label: "Document Portal", icon: "📁" },
  { key: "fullreport", label: "Full Report",    icon: "📊" },
  { key: "config",    label: "System Config",   icon: "⚙️" },
  { key: "notify",    label: "Notification",    icon: "🔔" },
  { key: "report",    label: "Report",          icon: "🗂️" },
];

function Sidebar({ active, onSelect }) {
  return (
    <div className="adm-sidebar">
      <div className="adm-sidebar-title">Fentons Admin</div>
      {NAV_ITEMS.map(item => (
        <button
          key={item.key}
          onClick={() => onSelect(item.key)}
          className={`adm-nav-btn ${active === item.key ? "active" : ""}`}
        >
          <span>{item.icon}</span><span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Filter bar (Today / 7 Days / 30 Days / Year / Custom + Operator) ─────

const RANGE_OPTIONS = [
  { key: "TODAY", label: "Today" },
  { key: "7D",    label: "7 Days" },
  { key: "30D",   label: "30 Days" },
  { key: "YEAR",  label: "Year" },
  { key: "CUSTOM", label: "Custom" },
];

function FilterBar({ range, setRange, fromDate, setFromDate, toDate, setToDate, operator, setOperator, operators }) {
  return (
    <div className="adm-filterbar">
      {RANGE_OPTIONS.map(opt => (
        <button
          key={opt.key}
          onClick={() => setRange(opt.key)}
          className={`adm-range-btn ${range === opt.key ? "active" : ""}`}
        >
          {opt.label}
        </button>
      ))}

      {range === "CUSTOM" && (
        <>
          <input type="date" className="adm-date-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          <span style={{ color: "#6c8bb3" }}>—</span>
          <input type="date" className="adm-date-input" value={toDate} onChange={e => setToDate(e.target.value)} />
        </>
      )}

      <select className="adm-operator-select" value={operator} onChange={e => setOperator(e.target.value)}>
        <option value="ALL">All Operators</option>
        {operators.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ── System Config panel ─────────────────────────────────────────────────

function SystemConfigPanel({ jobTypes, setJobTypes }) {
  const [newType, setNewType] = useState("");

  const addType = () => {
    const v = newType.trim();
    if (!v || jobTypes.includes(v)) return;
    const updated = [...jobTypes, v];
    setJobTypes(updated);
    saveJobTypes(updated);
    setNewType("");
  };
  const removeType = (t) => {
    const updated = jobTypes.filter(j => j !== t);
    setJobTypes(updated);
    saveJobTypes(updated);
  };

  return (
    <div className="adm-config-wrap">
      <h2 className="adm-title">⚙️ System Config</h2>
      <p className="adm-subtitle">
        Job types entered here drive the "Total Jobs by Job Type" cards on the Dashboard.
      </p>

      <div className="adm-config-add-row">
        <input
          className="adm-config-input"
          value={newType}
          onChange={e => setNewType(e.target.value)}
          placeholder="e.g. Balance, Domestic, Commercial..."
          onKeyDown={e => e.key === "Enter" && addType()}
        />
        <button className="adm-config-add-btn" onClick={addType}>+ Add</button>
      </div>

      <div className="adm-config-list">
        {jobTypes.map(t => (
          <div key={t} className="adm-config-item">
            <span className="adm-config-item-name">{t}</span>
            <button className="adm-config-remove-btn" onClick={() => removeType(t)}>✕ Remove</button>
          </div>
        ))}
        {jobTypes.length === 0 && <div className="adm-config-empty">No job types configured yet.</div>}
      </div>
    </div>
  );
}

// ── Notification panel ──────────────────────────────────────────────────

function NotificationPanel({ documents }) {
  const openErrors = documents.filter(d => (d.hasWrongMaterial || "").toUpperCase() === "YES" && !d.emergencyPickResolved);
  const overdue = documents.filter(d => {
    if (deliveryStatusClass(d.deliveryStatus) === "completed") return false;
    const key = docDateKey(d);
    if (!key) return false;
    const days = Math.floor((Date.now() - new Date(key).getTime()) / (1000 * 60 * 60 * 24));
    return days > 30;
  });

  return (
    <div>
      <h2 className="adm-title">🔔 Notifications</h2>

      <SectionTitle>🚨 Open Picking Errors ({openErrors.length})</SectionTitle>
      {openErrors.length === 0 ? <div className="adm-notify-empty">None</div> : (
        <div className="adm-notify-list">
          {openErrors.map(d => (
            <div key={d.id} className="adm-notify-item error">
              Doc #{d.id} · {d.printDocumentNo || "No doc no"} — wrong material reported at Check
            </div>
          ))}
        </div>
      )}

      <SectionTitle>⚠ Overdue Deliveries (30+ days, {overdue.length})</SectionTitle>
      {overdue.length === 0 ? <div className="adm-notify-empty">None</div> : (
        <div className="adm-notify-list">
          {overdue.map(d => (
            <div key={d.id} className="adm-notify-item warning">
              Doc #{d.id} · {d.printDocumentNo || "No doc no"} — still {deliveryStatusClass(d.deliveryStatus)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Report panel (job-type summary, with its own Excel export) ───────────

function exportJobTypeReport(rows, totalCount) {
  const data = [
    ...rows.map(r => ({ "Job Type": r.type, "Total Jobs": r.count })),
    { "Job Type": "Total", "Total Jobs": totalCount },
  ];
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Job Type Report");
  XLSX.writeFile(wb, `job_type_report_${toDateKey(new Date())}.xlsx`);
}

const REPORT_CATEGORY_OPTIONS = [
  { key: "all",      label: "All (Full Report)" },
  { key: "document", label: "Document / Confirm Details" },
  { key: "print",    label: "Print Details" },
  { key: "pick",     label: "Pick Details" },
  { key: "check",    label: "Check Details" },
  { key: "delivery", label: "Delivery Details" },
];

function ReportPanel({ documents, jobTypes }) {
  const [category, setCategory]           = useState("all");
  const [jobTypeFilter, setJobTypeFilter] = useState("ALL");
  const [dateFieldMode, setDateFieldMode] = useState("start"); // "start" | "hold"
  const [dateFrom, setDateFrom]           = useState("");
  const [dateTo, setDateTo]               = useState("");

  const stageDates = STAGE_DATE_FIELDS[category];
  const activeDateField = dateFieldMode === "hold" ? stageDates.hold : stageDates.start;

  const rows = useMemo(() => {
    return documents.filter(d => {
      if (jobTypeFilter !== "ALL" && (d.jobType || "").toLowerCase() !== jobTypeFilter.toLowerCase()) return false;
      if (!dateFieldInRange(d, activeDateField, dateFrom, dateTo)) return false;
      return true;
    });
  }, [documents, jobTypeFilter, activeDateField, dateFrom, dateTo]);

  const cols = PORTAL_COLUMNS[category];
  const categoryLabel = REPORT_CATEGORY_OPTIONS.find(o => o.key === category)?.label || category;

  return (
    <div>
      <h2 className="adm-title">🗂️ Report</h2>
      <p className="adm-subtitle">Pick a category, job type, and date range — the table below and the Excel export both follow your selection.</p>

      <div className="adm-xl-toolbar">
        <select
          className="adm-xl-select"
          value={category}
          onChange={e => { setCategory(e.target.value); setDateFieldMode("start"); }}
        >
          {REPORT_CATEGORY_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>

        <select className="adm-xl-select" value={jobTypeFilter} onChange={e => setJobTypeFilter(e.target.value)}>
          <option value="ALL">All Job Types</option>
          {jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <button
          className="adm-xl-export-btn"
          onClick={() => exportToExcel(rows, cols, `report_${category}`, categoryLabel.substring(0, 31))}
        >
          ⬇ Export {categoryLabel} ({rows.length})
        </button>
      </div>

      <div
        className="adm-xl-toolbar adm-xl-datefilter"
        style={{ flexWrap: "nowrap", overflowX: "auto" }}
      >
        <span className="adm-xl-datefilter-label" style={{ whiteSpace: "nowrap" }}>📅 {stageDates.label} date filter:</span>

        {stageDates.hold && (
          <select
            className="adm-xl-select"
            value={dateFieldMode}
            onChange={e => setDateFieldMode(e.target.value)}
            style={{ flexShrink: 0 }}
          >
            <option value="start">Start Date</option>
            <option value="hold">Hold Date</option>
          </select>
        )}

        <input type="date" className="adm-date-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ flexShrink: 0 }} />
        <span style={{ color: "#6c8bb3", flexShrink: 0 }}>—</span>
        <input type="date" className="adm-date-input" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ flexShrink: 0 }} />

        {(dateFrom || dateTo) && (
          <button className="adm-xl-clear-btn" style={{ flexShrink: 0, whiteSpace: "nowrap" }} onClick={() => { setDateFrom(""); setDateTo(""); }}>
            ✕ Clear dates
          </button>
        )}
      </div>

      <div className="adm-xl-table-wrap">
        <table className="adm-xl-table">
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="adm-eff-empty">No data for this filter</td></tr>
            ) : rows.map(d => (
              <tr key={d.id}>
                {cols.map(c => {
                  const isStatus = c.toLowerCase().includes("status");
                  return <td key={c}>{isStatus ? <StatusBadge status={d[c]} /> : String(d[c] ?? "")}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Dashboard panel ───────────────────────────────────────────────────────

function DashboardPanel({ documents, jobTypes }) {
  const print = portalCounts(documents, () => true, d => printStatusClass(d.printStatus));
  const pick = portalCounts(documents, d => !!d.printDocumentNo, d => pickStatusClass(d.status));
  const check = portalCounts(
    documents,
    d => pickStatusClass(d.status) === "completed" && !!d.printDocumentNo,
    d => checkStatusClass(d.checkStatus),
  );
  const delivery = portalCounts(
    documents,
    d => checkStatusClass(d.checkStatus) === "completed",
    d => deliveryStatusClass(d.deliveryStatus),
  );

  const deliveredDocs = documents.filter(d => deliveryStatusClass(d.deliveryStatus) === "completed");
  const filedCount    = deliveredDocs.filter(d => d.fileNumber).length;
  const holdCount     = documents.filter(d => deliveryStatusClass(d.deliveryStatus) === "onhold").length;
  const cancelledCount = documents.filter(d => deliveryStatusClass(d.deliveryStatus) === "cancelled").length;
  const pendingFileCount = deliveredDocs.length - filedCount;

  const printEff    = operatorEfficiency(documents, "printedBy", "printDurationSeconds", d => printStatusClass(d.printStatus) === "completed");
  const pickEff     = operatorEfficiency(documents, "pickedBy", "durationSeconds", d => pickStatusClass(d.status) === "completed");
  const checkEff    = operatorEfficiency(documents, "checkedBy", "checkDurationSeconds", d => checkStatusClass(d.checkStatus) === "completed");
  const deliveryEff = operatorEfficiency(documents, "deliveredBy", "deliveryDurationSeconds", d => deliveryStatusClass(d.deliveryStatus) === "completed");

  const jobTypeCounts = jobTypes.map(t => ({
    type: t,
    count: documents.filter(d => (d.jobType || "").toLowerCase() === t.toLowerCase()).length,
  }));

  return (
    <div>
      <h2 className="adm-title">Fentons Operation Efficiency Dashboard</h2>
      <p className="adm-subtitle">Live view, recalculates automatically as documents update.</p>

      <SectionTitle>Total Jobs by Job Type</SectionTitle>
      <div className="adm-kpi-row">
        <KpiCard label="Total Jobs" value={documents.length} colorClass="accent" />
        {jobTypeCounts.map(jt => (
          <KpiCard key={jt.type} label={jt.type} value={jt.count} />
        ))}
      </div>

      <SectionTitle>Total Jobs Issued Per Day / Portal</SectionTitle>
      <div className="adm-triple-row">
        <TripleStat title="🖨️ Print Portal"    {...print} />
        <TripleStat title="📦 Pick Portal"     {...pick} />
        <TripleStat title="✅ Check Portal"    {...check} />
        <TripleStat title="🚚 Delivery Portal" {...delivery} />
      </div>

      <SectionTitle>Document Filing Status</SectionTitle>
      <div className="adm-kpi-row">
        <KpiCard label="Delivered (Total)" value={deliveredDocs.length} colorClass="green" />
        <KpiCard label="Filed" value={filedCount} colorClass="accent" />
        <KpiCard label="Pending File" value={pendingFileCount} colorClass="orange" />
        <KpiCard label="On Hold" value={holdCount} colorClass="orange" />
        <KpiCard label="Cancelled" value={cancelledCount} colorClass="red" />
      </div>

      <SectionTitle>System Efficiency — by Operator</SectionTitle>
      <div className="adm-eff-row">
        <EfficiencyTable title="🖨️ Print Efficiency" rows={printEff} />
        <EfficiencyTable title="📦 Picking Efficiency" rows={pickEff} />
        <EfficiencyTable title="✅ Checking Efficiency" rows={checkEff} />
        <EfficiencyTable title="🚚 Delivery Efficiency" rows={deliveryEff} />
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [activeView, setActiveView] = useState("dashboard");

  const [documents, setDocuments]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  const [range, setRange]       = useState("30D");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]     = useState("");
  const [operator, setOperator] = useState("ALL");

  const [jobTypes, setJobTypes] = useState(loadJobTypes());

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(MASTER_API);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setDocuments(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDocuments(false); }, [fetchDocuments]);
  useEffect(() => {
    const id = setInterval(() => fetchDocuments(true), AUTO_REFRESH);
    return () => clearInterval(id);
  }, [fetchDocuments]);

  const operators = useMemo(() => {
    const set = new Set();
    documents.forEach(d => docOperators(d).forEach(n => set.add(n)));
    return Array.from(set).sort();
  }, [documents]);

  const filtered = useMemo(() => {
    return documents.filter(d => {
      if (!inRange(d, range, fromDate, toDate)) return false;
      if (operator !== "ALL" && !docOperators(d).includes(operator)) return false;
      return true;
    });
  }, [documents, range, fromDate, toDate, operator]);

  return (
    <div className="adm-page">
      <Sidebar active={activeView} onSelect={setActiveView} />

      <div className="adm-main">

        {activeView === "dashboard" && (
          <>
            <FilterBar
              range={range} setRange={setRange}
              fromDate={fromDate} setFromDate={setFromDate}
              toDate={toDate} setToDate={setToDate}
              operator={operator} setOperator={setOperator}
              operators={operators}
            />

            {loading && <div className="adm-loading">Loading dashboard…</div>}
            {error && (
              <div className="adm-error">
                ⚠ {error} — <button onClick={() => fetchDocuments(false)}>retry</button>
              </div>
            )}
            {!loading && !error && <DashboardPanel documents={filtered} jobTypes={jobTypes} />}
          </>
        )}

        {activeView === "print"    && <IssuePrintForm />}
        {activeView === "pick"     && <IssuPrint />}
        {activeView === "check"    && <IssueCheckForm />}
        {activeView === "delivery" && <IssueDeliveryForm />}
        {activeView === "document" && <ConfirmPortal />}
        {activeView === "fullreport" && <DocumentsExcelPanel documents={documents} jobTypes={jobTypes} />}
        {activeView === "config"   && <SystemConfigPanel jobTypes={jobTypes} setJobTypes={setJobTypes} />}
        {activeView === "notify"   && <NotificationPanel documents={documents} />}
        {activeView === "report"   && <ReportPanel documents={documents} jobTypes={jobTypes} />}
      </div>
    </div>
  );
}



const PORTAL_COLUMNS = {
  print: ["id","printDocumentNo","jobType","customerName","requestedBy","requestDate","enteredBy",
    "printStartTime","printHoldTime","printResumeTime","printEndTime","printHoldReason","printHeldBy",
    "printTotalHoldSeconds","printDurationSeconds","printedBy","printHandedOverBy","printStatus"],
  pick: ["id","printDocumentNo","jobType","requestDate",
    "startTime","holdTime","resumeTime","endTime","holdReason","heldBy",
    "totalHoldSeconds","durationSeconds","pickedBy","status"],
  check: ["id","printDocumentNo","jobType","requestDate",
    "checkStartTime","checkHoldTime","checkResumeTime","checkEndTime","checkHoldReason","checkHeldBy",
    "checkTotalHoldSeconds","checkDurationSeconds","checkedBy",
    "hasWrongMaterial","wrongMaterialSku","wrongMaterialQty","checkStatus"],
  delivery: ["id","printDocumentNo","jobType","requestDate",
    "deliveryStartTime","deliveryHoldTime","deliveryResumeTime","deliveryEndTime","deliveryHoldReason","deliveryHeldBy",
    "deliveryTotalHoldSeconds","deliveryDurationSeconds","deliveredBy","deliveryVehicleNo",
    "deliveryCancelReason","deliveryCancelledBy","deliveryCancelTime",
    "deliveryConfirmed","deliveryConfirmedBy","deliveryConfirmTime","deliveryStatus"],
  // Document / Confirm Details only — a smaller subset of "all", used by the
  // Report page's "Document / Confirm Details" filter option.
  document: ["id","requestedBy","vehicleNo","customerName","enteredBy","jobType","jobwbs",
    "requestDate","requestTime","reservationNo","status","createdDatetime",
    "deliveryConfirmed","deliveryConfirmedBy","deliveryConfirmTime",
    "cancelConfirmed","cancelConfirmedBy","cancelConfirmTime","reqId","fileNumber"],
  // "all" = every column on the Issue entity, in one combined table/export
  // FIX: "status" was previously listed twice here (once near the top-level
  // document fields, once again next to the Pick-portal fields), which caused
  // a duplicate table/th React key warning and a doubled "status" column in
  // every "All Portals (combined)" export. Now it appears exactly once.
  all: ["id","requestedBy","vehicleNo","customerName","enteredBy","jobType","jobwbs",
    "requestDate","requestTime","reservationNo","status","createdDatetime",
    "printDocumentNo","printHandoverTime","printHandedOverBy",
    "printStatus","printStartTime","printHoldTime","printResumeTime","printEndTime","printHoldReason","printHeldBy","printTotalHoldSeconds","printDurationSeconds","printedBy",
    "startTime","holdTime","resumeTime","endTime","holdReason","heldBy","totalHoldSeconds","durationSeconds","pickedBy",
    "checkStatus","checkStartTime","checkHoldTime","checkResumeTime","checkEndTime","checkHoldReason","checkHeldBy","checkTotalHoldSeconds","checkDurationSeconds","checkedBy",
    "hasWrongMaterial","wrongMaterialSku","wrongMaterialQty",
    "emergencyPickResolved","emergencyPickResolvedBy","emergencyResolvedTime",
    "deliveryStatus","deliveryStartTime","deliveryHoldTime","deliveryResumeTime","deliveryEndTime","deliveryHoldReason","deliveryHeldBy","deliveryTotalHoldSeconds","deliveryDurationSeconds","deliveredBy","deliveryVehicleNo",
    "deliveryCancelReason","deliveryCancelledBy","deliveryCancelTime",
    "deliveryConfirmed","deliveryConfirmedBy","deliveryConfirmTime","cancelConfirmed","cancelConfirmedBy","cancelConfirmTime",
    "reqId","fileNumber"],
};

// Which fields represent "Start" and "Hold" dates for each stage, used by the
// Full Report panel's date-wise filter. "all"/document view filters by
// requestDate only (document entry date has no separate hold date).
const STAGE_DATE_FIELDS = {
  all:      { start: "requestDate",        hold: null,               label: "All" },
  document: { start: "requestDate",        hold: null,               label: "Document" },
  print:    { start: "printStartTime",     hold: "printHoldTime",    label: "Print" },
  pick:     { start: "startTime",          hold: "holdTime",         label: "Pick" },
  check:    { start: "checkStartTime",     hold: "checkHoldTime",    label: "Check" },
  delivery: { start: "deliveryStartTime",  hold: "deliveryHoldTime", label: "Delivery" },
};

// Simple inclusive from/to date-string comparison (YYYY-MM-DD), tolerant of
// full datetime values (only the date portion is compared).
function dateFieldInRange(doc, field, fromDate, toDate) {
  if (!fromDate && !toDate) return true;
  if (!field) return true;
  const key = toDateKey(doc[field]);
  if (!key) return false;
  if (fromDate && key < fromDate) return false;
  if (toDate && key > toDate) return false;
  return true;
}

function exportToExcel(docs, columns, filename, sheetName) {
  const rows = docs.map(d => {
    const row = {};
    columns.forEach(c => { row[c] = d[c] ?? ""; });
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}_${toDateKey(new Date())}.xlsx`);
}

function DocumentsExcelPanel({ documents, jobTypes }) {
  const [jobTypeFilter, setJobTypeFilter] = useState("ALL");
  const [portalFilter, setPortalFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Date-wise filter: which date field (Start / Hold) of the CURRENTLY
  // selected portal to filter on, plus a from/to range. Resets sensibly
  // when the portal changes (hold isn't available for "all"/document view).
  const [dateFieldMode, setDateFieldMode] = useState("start"); // "start" | "hold"
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const stageDates = STAGE_DATE_FIELDS[portalFilter];
  const activeDateField = dateFieldMode === "hold" ? stageDates.hold : stageDates.start;

  const rows = useMemo(() => {
    return documents.filter(d => {
      if (jobTypeFilter !== "ALL" && (d.jobType || "").toLowerCase() !== jobTypeFilter.toLowerCase()) return false;
      if (!dateFieldInRange(d, activeDateField, dateFrom, dateTo)) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = `${d.printDocumentNo || ""} ${d.customerName || ""} ${d.id}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [documents, jobTypeFilter, search, activeDateField, dateFrom, dateTo]);

  const cols = PORTAL_COLUMNS[portalFilter];

  return (
    <div>
      <h2 className="adm-title">📊 All Documents</h2>
      <p className="adm-subtitle">Every document, every portal, one table.</p>

      <div className="adm-xl-toolbar">
        <select className="adm-xl-select" value={jobTypeFilter} onChange={e => setJobTypeFilter(e.target.value)}>
          <option value="ALL">All Job Types</option>
          {jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <select
          className="adm-xl-select"
          value={portalFilter}
          onChange={e => {
            setPortalFilter(e.target.value);
            setDateFieldMode("start"); // reset to Start when switching portal/table
          }}
        >
          <option value="all">All Portals (combined)</option>
          <option value="print">Print Portal</option>
          <option value="pick">Pick Portal</option>
          <option value="check">Check Portal</option>
          <option value="delivery">Delivery Portal</option>
        </select>
        

        <input
          className="adm-xl-search"
          placeholder="Search doc no / customer / id…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <button
          className="adm-xl-export-btn"
          onClick={() => exportToExcel(rows, cols, `${portalFilter}_documents`, portalFilter)}
        >
          ⬇ Export {portalFilter === "all" ? "This View" : portalFilter}
        </button>

        <button
          className="adm-xl-export-btn all"
          onClick={() => {
            const wb = XLSX.utils.book_new();
            Object.entries(PORTAL_COLUMNS).forEach(([key, columns]) => {
              const sheetRows = rows.map(d => {
                const row = {};
                columns.forEach(c => { row[c] = d[c] ?? ""; });
                return row;
              });
              XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), key);
            });
            XLSX.writeFile(wb, `full_report_${toDateKey(new Date())}.xlsx`);
          }}
        >
          ⬇ Export Full Report (all portals)
        </button>

        <button
          className="adm-xl-export-btn jobtype"
          onClick={() => {
            // One workbook, one sheet PER job type (using the currently selected
            // portal's columns), built from ALL documents — ignores the jobType
            // dropdown above so every type is always included.
            const wb = XLSX.utils.book_new();
            jobTypes.forEach(t => {
              const typeRows = documents
                .filter(d => (d.jobType || "").toLowerCase() === t.toLowerCase())
                .map(d => {
                  const row = {};
                  cols.forEach(c => { row[c] = d[c] ?? ""; });
                  return row;
                });
              // Excel sheet names: max 31 chars, no \ / ? * [ ] :
              const safeName = t.replace(/[\\/?*[\]:]/g, "-").substring(0, 31) || "Sheet";
              XLSX.utils.book_append_sheet(
                wb,
                XLSX.utils.json_to_sheet(typeRows.length ? typeRows : [{}]),
                safeName
              );
            });
            XLSX.writeFile(wb, `by_jobtype_report_${portalFilter}_${toDateKey(new Date())}.xlsx`);
          }}
        >
          ⬇ Export by Job Type (separate sheets)
        </button>
      </div>

      {/* ── Date-wise filter for the currently selected portal/table ── */}
      <div className="adm-xl-toolbar adm-xl-datefilter">
        <span className="adm-xl-datefilter-label">📅 {stageDates.label} date filter:</span>

        {stageDates.hold && (
          <select
            className="adm-xl-select"
            value={dateFieldMode}
            onChange={e => setDateFieldMode(e.target.value)}
          >
            <option value="start">Start Date</option>
            <option value="hold">Hold Date</option>
          </select>
        )}

        <input type="date" className="adm-date-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span style={{ color: "#6c8bb3" }}>—</span>
        <input type="date" className="adm-date-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />

        {(dateFrom || dateTo) && (
          <button
            className="adm-xl-clear-btn"
            onClick={() => { setDateFrom(""); setDateTo(""); }}
          >
            ✕ Clear dates
          </button>
        )}
      </div>

      <div className="adm-xl-table-wrap">
        <table className="adm-xl-table">
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map(d => (
              <tr key={d.id}>
                {cols.map(c => {
                  const isStatus = c.toLowerCase().includes("status");
                  return <td key={c}>{isStatus ? <StatusBadge status={d[c]} /> : String(d[c] ?? "")}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
