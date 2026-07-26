import { useState, useEffect, useCallback, useMemo } from "react";
import "./AdminDashboard.css";
import * as XLSX from "xlsx";

// ── Portal pages (rendered inline when their sidebar item is selected) ─────
import IssuePrintForm    from "../Issue_Print_Portal/IssuePrintForm";
import IssuPrint         from "../Issue_Pick_Portal/IssuePickForm";
import IssueCheckForm    from "../Issue_Check_Portal/IssueCheckForm";
import IssueDeliveryForm from "../Issue_Delivery_Portal/IssueDeliveryForm";
import ConfirmPortal     from "../Confirm_Portal/ConfirmPortal";
import DocumentForm      from "../Documents_Portal/DocumentForm";
// NOTE: AdminConfigCenter (old "usersetup" page) removed — replaced by
// MasterSetupPanel below, which now lives inside this same file and saves
// everything straight to the database through AdminSetupController.

// ── Config ───────────────────────────────────────────────────────────────
// const MASTER_API   = "http://localhost:8080/api/print-portal";
// const SETUP_API    = "http://localhost:8080/api/admin-setup";
const MASTER_API   = "https://time-tracker-system-production.up.railway.app/api/print-portal";
const SETUP_API    = "https://time-tracker-system-production.up.railway.app/api/admin-setup";
const AUTO_REFRESH = 1000;

// ── Generic helpers ──────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }

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
  if (!key) return false;

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

// Division filter — a document "belongs" to a division if ANY operator
// who touched it (printer, picker, checker, deliverer) is registered under
// that division in Master Setup. operatorDivisionMap is name -> divisionNo,
// built once by merging the 4 operator master tables.
function docMatchesDivision(doc, divisionNo, operatorDivisionMap) {
  if (!divisionNo || divisionNo === "ALL") return true;
  const names = [doc.printedBy, doc.pickedBy, doc.checkedBy, doc.deliveredBy].filter(Boolean);
  return names.some(n => operatorDivisionMap[n] === divisionNo);
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

// ── Live duration engine ──────────────────────────────────────────────────

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
  return Math.max((nowMs - start) / 1000 - totalHold, 0);
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

function useTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ── Icon set ─────────────────────────────────────────────────────────────

const ICON_PROPS = {
  width: 17, height: 17, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
};

const Icon = {
  dashboard: (p) => (
    <svg {...ICON_PROPS} {...p}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>
  ),
  docentry: (p) => (
    <svg {...ICON_PROPS} {...p}>
      <path d="M7 3h7l4 4v14H7z"/>
      <path d="M14 3v4h4"/>
      <path d="M9.5 13h5"/>
      <path d="M12 15v-4"/>
    </svg>
  ),
  print: (p) => (
    <svg {...ICON_PROPS} {...p}><path d="M6 9V3h12v6"/><rect x="5" y="9" width="14" height="7" rx="1.2"/><path d="M6 16h12v5H6z"/></svg>
  ),
  pick: (p) => (
    <svg {...ICON_PROPS} {...p}><path d="M3 8l9-5 9 5-9 5-9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>
  ),
  check: (p) => (
    <svg {...ICON_PROPS} {...p}><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>
  ),
  delivery: (p) => (
    <svg {...ICON_PROPS} {...p}><rect x="1.5" y="7" width="12" height="9" rx="1"/><path d="M13.5 10.5H18l3 3V16h-7.5z"/><circle cx="6" cy="18" r="1.6"/><circle cx="16.5" cy="18" r="1.6"/></svg>
  ),
  document: (p) => (
    <svg {...ICON_PROPS} {...p}><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 12h5M9.5 15.5h5"/></svg>
  ),
  report: (p) => (
    <svg {...ICON_PROPS} {...p}><path d="M4 20V10M11 20V4M18 20v-7"/></svg>
  ),
  setup: (p) => (
    <svg {...ICON_PROPS} {...p}><circle cx="12" cy="12" r="2.8"/><path d="M12 3v2.4M12 18.6V21M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M3 12h2.4M18.6 12H21M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></svg>
  ),
  bell: (p) => (
    <svg {...ICON_PROPS} {...p}><path d="M6 10a6 6 0 1112 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z"/><path d="M10 19a2 2 0 004 0"/></svg>
  ),
  folder: (p) => (
    <svg {...ICON_PROPS} {...p}><path d="M3 6.5A1.5 1.5 0 014.5 5H10l2 2.5h7A1.5 1.5 0 0120.5 9v9A1.5 1.5 0 0119 19.5H4.5A1.5 1.5 0 013 18z"/></svg>
  ),
  staff: (p) => (
    <svg {...ICON_PROPS} {...p}><circle cx="9" cy="7.5" r="3.2"/><path d="M2.5 20c0-4 3-6.5 6.5-6.5S15.5 16 15.5 20"/><path d="M16 7a3.2 3.2 0 010 6.2M18 13.6c2.4.5 3.8 2.4 3.8 4.9"/></svg>
  ),
  users: (p) => (
    <svg {...ICON_PROPS} {...p}><rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.2" r="2"/><path d="M5 15.2c.6-1.6 1.9-2.4 3.5-2.4s2.9.8 3.5 2.4"/><path d="M14.5 9h4M14.5 13h4"/></svg>
  ),
  division: (p) => (
    <svg {...ICON_PROPS} {...p}><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7.5h2M14 7.5h2M8 11.5h2M14 11.5h2M8 15.5h2M14 15.5h2"/></svg>
  ),
  picker: (p) => (
    <svg {...ICON_PROPS} {...p}><path d="M4 8l8-4.5L20 8v8l-8 4.5L4 16z"/><path d="M4 8l8 4.5L20 8M12 12.5V21"/></svg>
  ),
  category: (p) => (
    <svg {...ICON_PROPS} {...p}><path d="M20.5 12.9L12.9 20.5a2 2 0 01-2.8 0L3.5 13.9a2 2 0 010-2.8L11.1 3.5a2 2 0 012.8 0l6.6 6.6a2 2 0 010 2.8z"/><circle cx="9" cy="9" r="1.4"/></svg>
  ),
  fileno: (p) => (
    <svg {...ICON_PROPS} {...p}><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>
  ),
  logout: (p) => (
    <svg {...ICON_PROPS} {...p}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
  ),
};

// ── Sidebar ──────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { key: "dashboard",   label: "Dashboard",       icon: Icon.dashboard },
  { key: "docentry",    label: "DocumentForm",    icon: Icon.docentry },
  { key: "print",       label: "Print Portal",    icon: Icon.print },
  { key: "pick",        label: "Picking Portal",  icon: Icon.pick },
  { key: "check",       label: "Checking Portal", icon: Icon.check },
  { key: "delivery",    label: "Delivery Portal", icon: Icon.delivery },
  { key: "document",    label: "Document Portal", icon: Icon.folder },
  { key: "fullreport",  label: "Full Report",     icon: Icon.dashboard },
  { key: "mastersetup", label: "Master Setup",    icon: Icon.setup },
  { key: "notify",      label: "Notification",    icon: Icon.bell },
  { key: "report",      label: "Report",          icon: Icon.report },
];

function handleLogout() {
  try {
    localStorage.removeItem("authToken");
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.clear();
  } catch (e) { /* ignore storage errors */ }
  window.location.href = "/login";
}

function Sidebar({ active, onSelect, open, onClose }) {
  return (
    <>
      {open && <div className="adm-sidebar-scrim" onClick={onClose} />}
      <div className={`adm-sidebar ${open ? "open" : ""}`} style={{ display: "flex", flexDirection: "column" }}>
        <div className="adm-sidebar-title">Fentons Admin</div>
        <div style={{ flex: 1 }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              onClick={() => { onSelect(item.key); onClose && onClose(); }}
              className={`adm-nav-btn ${active === item.key ? "active" : ""}`}
            >
              <span className="adm-nav-icon"><item.icon /></span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={handleLogout}
          className="adm-nav-btn adm-nav-logout"
          style={{ marginTop: "auto" }}
        >
          <span className="adm-nav-icon"><Icon.logout /></span>
          <span>Logout</span>
        </button>
      </div>
    </>
  );
}

// ── Filter bar ── (now includes a Division filter) ────────────────────────

const RANGE_OPTIONS = [
  { key: "TODAY", label: "Today" },
  { key: "7D",    label: "7 Days" },
  { key: "30D",   label: "30 Days" },
  { key: "YEAR",  label: "Year" },
  { key: "CUSTOM", label: "Custom" },
];

function FilterBar({
  range, setRange, fromDate, setFromDate, toDate, setToDate,
  operator, setOperator, operators,
  division, setDivision, divisions,
}) {
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

      {/* <select className="adm-operator-select" value={operator} onChange={e => setOperator(e.target.value)}>
        <option value="ALL">All Operators</option>
        {operators.map(o => <option key={o} value={o}>{o}</option>)}
      </select> */}

      <select className="adm-operator-select" value={division} onChange={e => setDivision(e.target.value)}>
        <option value="ALL">All Divisions</option>
        {divisions.map(d => (
          <option key={d.id ?? d.divisionNo} value={d.divisionNo}>
            {d.divisionNo} — {d.divisionName}
          </option>
        ))}
      </select>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ── MASTER SETUP PANEL — the 10 buttons in one row, all saving to the DB ──
// ═══════════════════════════════════════════════════════════════════════

async function apiGet(path) {
  const res = await fetch(`${SETUP_API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(`${SETUP_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `POST ${path} failed`);
  return res.json();
}
async function apiPut(path, body) {
  const res = await fetch(`${SETUP_API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `PUT ${path} failed`);
  return res.json();
}
async function apiDelete(path) {
  const res = await fetch(`${SETUP_API}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

const SETUP_TABS = [
  { key: "staff",    label: "Staff / User Character", icon: Icon.staff },
  { key: "users",    label: "User Accounts",          icon: Icon.users },
  { key: "division", label: "Division",               icon: Icon.division },
  { key: "picker",   label: "Picker",                 icon: Icon.picker },
  { key: "print",    label: "Document / Print",       icon: Icon.print },
  { key: "check",    label: "Check",                  icon: Icon.check },
  { key: "delivery", label: "Delivery",                icon: Icon.delivery },
  { key: "filed",    label: "Filed",                  icon: Icon.folder },
  { key: "jobcat",   label: "Job Category",           icon: Icon.category },
  { key: "fileno",   label: "Document File No",       icon: Icon.fileno },
];

// Configuration for the 5 identical "name master" panels (Picker, Print/
// Document, Check, Delivery, Filed) — same UI, different endpoint/table.
// Each now also carries a Division (divisionNo), saved to the same table.
const OPERATOR_PANEL_CONFIG = {
  picker: {
    path: "/pickers", nameField: "pickerName", nicField: "nic", nicNameField: "pickerNicName",
    nameLabel: "Picker Name", nicNameLabel: "Picker NIC Name",
  },
  print: {
    path: "/print-operators", nameField: "operatorName", nicField: "nic", nicNameField: "operatorNicName",
    nameLabel: "Operator Name", nicNameLabel: "Operator NIC Name",
  },
  check: {
    path: "/check-operators", nameField: "operatorName", nicField: "nic", nicNameField: "operatorNicName",
    nameLabel: "Operator Name", nicNameLabel: "Operator NIC Name",
  },
  delivery: {
    path: "/delivery-operators", nameField: "operatorName", nicField: "nic", nicNameField: "operatorNicName",
    nameLabel: "Operator Name", nicNameLabel: "Operator NIC Name",
  },
  filed: {
    path: "/file-operators", nameField: "operatorName", nicField: "nic", nicNameField: "operatorNicName",
    nameLabel: "Operator Name", nicNameLabel: "Operator NIC Name",
  },
};

function SetupTable({ rows, cols, onEdit, onDelete }) {
  return (
    <div className="adm-xl-table-wrap" style={{ marginTop: 14 }}>
      <table className="adm-xl-table">
        <thead>
          <tr>
            {cols.map(c => <th key={c.key}>{c.label}</th>)}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length + 1} className="adm-eff-empty">No records yet</td></tr>
          ) : rows.map(r => (
            <tr key={r.id}>
              {cols.map(c => <td key={c.key}>{String(r[c.key] ?? "")}</td>)}
              <td>
                <button className="adm-setup-edit-btn" onClick={() => onEdit(r)}>Edit</button>
                <button className="adm-setup-del-btn" onClick={() => onDelete(r.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 1) Staff / User Character panel ──────────────────────────────────────
function StaffPanel() {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => { apiGet("/staff").then(setRows).catch(e => setErr(e.message)); }, []);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    if (!name.trim()) return;
    try {
      const body = { name, createdBy: "admin" };
      if (editId) await apiPut(`/staff/${editId}`, body); else await apiPost("/staff", body);
      setName(""); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title"><Icon.staff /> Staff / User Character — create names used across document entering, printing, picking, checking, delivering & filing</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-row">
        <input className="adm-config-input" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setName(""); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={rows}
        cols={[{ key: "id", label: "ID" }, { key: "name", label: "Name" }, { key: "createdBy", label: "Created By" }]}
        onEdit={r => { setEditId(r.id); setName(r.name); }}
        onDelete={id => apiDelete(`/staff/${id}`).then(load)}
      />
    </div>
  );
}

// ── 2) User Accounts panel ──────────────────────────────────────────────
function UserAccountsPanel() {
  const [staffOptions, setStaffOptions] = useState([]);
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ staffName: "", fullName: "", nic: "", username: "", password: "", confirmPassword: "" });
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);
  const [showForgot, setShowForgot] = useState(false);
  const [forgot, setForgot] = useState({ username: "", nic: "", newPassword: "" });
  const [forgotMsg, setForgotMsg] = useState(null);

  const load = useCallback(() => {
    apiGet("/staff").then(list => setStaffOptions(list.map(s => s.name)));
    apiGet("/users").then(setRows).catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    setErr(null);
    try {
      const body = { ...form, createdBy: "admin" };
      if (editId) await apiPut(`/users/${editId}`, body); else await apiPost("/users", body);
      setForm({ staffName: "", fullName: "", nic: "", username: "", password: "", confirmPassword: "" });
      setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  const submitForgot = async () => {
    setForgotMsg(null);
    try {
      await apiPost("/users/forgot-password", forgot);
      setForgotMsg("Password reset successfully.");
      setForgot({ username: "", nic: "", newPassword: "" });
      load();
    } catch (e) { setForgotMsg(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title"><Icon.users /> User Accounts — grants system / API login access (password stored hashed)</h3>
      {err && <div className="adm-error">⚠ {err}</div>}

      <div className="adm-setup-form-grid">
        <select className="adm-operator-select" value={form.staffName} onChange={e => setForm({ ...form, staffName: e.target.value })}>
          <option value="">Select staff / user character…</option>
          {staffOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <input className="adm-config-input" placeholder="Full Name" value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} />
        <input className="adm-config-input" placeholder="NIC" value={form.nic} onChange={e => setForm({ ...form, nic: e.target.value })} />
        <input className="adm-config-input" placeholder="Username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
        <input className="adm-config-input" type="password" placeholder="Password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
        <input className="adm-config-input" type="password" placeholder="Confirm Password" value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} />
      </div>
      <div className="adm-setup-form-row">
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update Account" : "+ Create Account"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setForm({ staffName: "", fullName: "", nic: "", username: "", password: "", confirmPassword: "" }); }}>Cancel</button>}
        <button className="adm-setup-forgot-btn" onClick={() => setShowForgot(s => !s)}>Forgot Password?</button>
      </div>

      {showForgot && (
        <div className="adm-setup-forgot-box">
          <input className="adm-config-input" placeholder="Username" value={forgot.username} onChange={e => setForgot({ ...forgot, username: e.target.value })} />
          <input className="adm-config-input" placeholder="NIC (to verify identity)" value={forgot.nic} onChange={e => setForgot({ ...forgot, nic: e.target.value })} />
          <input className="adm-config-input" type="password" placeholder="New Password" value={forgot.newPassword} onChange={e => setForgot({ ...forgot, newPassword: e.target.value })} />
          <button className="adm-config-add-btn" onClick={submitForgot}>Reset Password</button>
          {forgotMsg && <div className="adm-setup-forgot-msg">{forgotMsg}</div>}
        </div>
      )}

      <SetupTable
        rows={rows}
        cols={[
          { key: "id", label: "ID" }, { key: "staffName", label: "Staff Name" }, { key: "fullName", label: "Full Name" },
          { key: "nic", label: "NIC" }, { key: "username", label: "Username" }, { key: "createdBy", label: "Created By" },
        ]}
        onEdit={r => { setEditId(r.id); setForm({ staffName: r.staffName || "", fullName: r.fullName || "", nic: r.nic || "", username: r.username || "", password: "", confirmPassword: "" }); }}
        onDelete={id => apiDelete(`/users/${id}`).then(load)}
      />
    </div>
  );
}

// ── Division panel ────────────────────────────────────────────────────────
function DivisionPanel() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ divisionName: "", divisionNo: "", divisionHead: "" });
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => { apiGet("/divisions").then(setRows).catch(e => setErr(e.message)); }, []);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    try {
      const body = { ...form, enteredBy: "admin" };
      if (editId) await apiPut(`/divisions/${editId}`, body); else await apiPost("/divisions", body);
      setForm({ divisionName: "", divisionNo: "", divisionHead: "" }); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title"><Icon.division /> Division</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-grid">
        <input className="adm-config-input" placeholder="Division Name" value={form.divisionName} onChange={e => setForm({ ...form, divisionName: e.target.value })} />
        <input className="adm-config-input" placeholder="Division No" value={form.divisionNo} onChange={e => setForm({ ...form, divisionNo: e.target.value })} />
        <input className="adm-config-input" placeholder="Division Head" value={form.divisionHead} onChange={e => setForm({ ...form, divisionHead: e.target.value })} />
      </div>
      <div className="adm-setup-form-row">
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setForm({ divisionName: "", divisionNo: "", divisionHead: "" }); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={rows}
        cols={[{ key: "id", label: "ID" }, { key: "divisionName", label: "Name" }, { key: "divisionNo", label: "No" }, { key: "divisionHead", label: "Head" }, { key: "enteredBy", label: "Entered By" }]}
        onEdit={r => { setEditId(r.id); setForm({ divisionName: r.divisionName || "", divisionNo: r.divisionNo || "", divisionHead: r.divisionHead || "" }); }}
        onDelete={id => apiDelete(`/divisions/${id}`).then(load)}
      />
    </div>
  );
}

// ── Generic "operator" master panel — reused for Picker / Print / Check /
// Delivery / Filed. Now includes a Division dropdown (divisionNo), sourced
// from the Division master table, and saved onto the same operator row. ──
function OperatorPanel({ tabKey }) {
  const cfg = OPERATOR_PANEL_CONFIG[tabKey];
  const TabIcon = SETUP_TABS.find(t => t.key === tabKey)?.icon || Icon.staff;
  const [rows, setRows] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [form, setForm] = useState({ name: "", nic: "", nicName: "", divisionNo: "" });
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    apiGet(cfg.path).then(setRows).catch(e => setErr(e.message));
    apiGet("/divisions").then(setDivisions).catch(() => {});
  }, [cfg.path]);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  // divisionNo -> divisionName, so the table can show both together.
  const divisionNameByNo = useMemo(() => {
    const map = {};
    divisions.forEach(d => { map[d.divisionNo] = d.divisionName; });
    return map;
  }, [divisions]);

  const submit = async () => {
    try {
      const body = {
        [cfg.nameField]: form.name, [cfg.nicField]: form.nic, [cfg.nicNameField]: form.nicName,
        divisionNo: form.divisionNo, createdBy: "admin",
      };
      if (editId) await apiPut(`${cfg.path}/${editId}`, body); else await apiPost(cfg.path, body);
      setForm({ name: "", nic: "", nicName: "", divisionNo: "" }); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  const displayRows = rows.map(r => ({
    ...r,
    divisionLabel: r.divisionNo ? `${r.divisionNo} — ${divisionNameByNo[r.divisionNo] || ""}` : "—",
  }));

  return (
    <div>
      <h3 className="adm-setup-title"><TabIcon /> {cfg.nameLabel} Setup</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-grid">
        <input className="adm-config-input" placeholder={cfg.nameLabel} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input className="adm-config-input" placeholder="NIC" value={form.nic} onChange={e => setForm({ ...form, nic: e.target.value })} />
        <input className="adm-config-input" placeholder={cfg.nicNameLabel} value={form.nicName} onChange={e => setForm({ ...form, nicName: e.target.value })} />
        <select className="adm-operator-select" value={form.divisionNo} onChange={e => setForm({ ...form, divisionNo: e.target.value })}>
          <option value="">Select division…</option>
          {divisions.map(d => (
            <option key={d.id ?? d.divisionNo} value={d.divisionNo}>
              {d.divisionNo} — {d.divisionName}
            </option>
          ))}
        </select>
      </div>
      <div className="adm-setup-form-row">
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setForm({ name: "", nic: "", nicName: "", divisionNo: "" }); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={displayRows}
        cols={[
          { key: "id", label: "ID" }, { key: cfg.nameField, label: cfg.nameLabel }, { key: cfg.nicField, label: "NIC" },
          { key: cfg.nicNameField, label: cfg.nicNameLabel }, { key: "divisionLabel", label: "Division" }, { key: "createdBy", label: "Created By" },
        ]}
        onEdit={r => { setEditId(r.id); setForm({ name: r[cfg.nameField] || "", nic: r[cfg.nicField] || "", nicName: r[cfg.nicNameField] || "", divisionNo: r.divisionNo || "" }); }}
        onDelete={id => apiDelete(`${cfg.path}/${id}`).then(load)}
      />
    </div>
  );
}

// ── Job Category panel (dropdown from Division) ────────────────────────
function JobCategoryPanel() {
  const [divisions, setDivisions] = useState([]);
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ categoryName: "", divisionName: "" });
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    apiGet("/divisions").then(list => setDivisions(list.map(d => d.divisionName)));
    apiGet("/job-categories").then(setRows).catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    try {
      const body = { ...form, createdBy: "admin" };
      if (editId) await apiPut(`/job-categories/${editId}`, body); else await apiPost("/job-categories", body);
      setForm({ categoryName: "", divisionName: "" }); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title"><Icon.category /> Job Category</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-grid">
        <select className="adm-operator-select" value={form.divisionName} onChange={e => setForm({ ...form, divisionName: e.target.value })}>
          <option value="">Select division…</option>
          {divisions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input className="adm-config-input" placeholder="Job Category Name" value={form.categoryName} onChange={e => setForm({ ...form, categoryName: e.target.value })} />
      </div>
      <div className="adm-setup-form-row">
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Save"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setForm({ categoryName: "", divisionName: "" }); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={rows}
        cols={[{ key: "id", label: "ID" }, { key: "categoryName", label: "Category" }, { key: "divisionName", label: "Division" }, { key: "createdBy", label: "Created By" }]}
        onEdit={r => { setEditId(r.id); setForm({ categoryName: r.categoryName || "", divisionName: r.divisionName || "" }); }}
        onDelete={id => apiDelete(`/job-categories/${id}`).then(load)}
      />
    </div>
  );
}

// ── Document File No panel ───────────────────────────────────────────────
// "Active" is no longer a manual checkbox. Every file's status is derived
// automatically, live, from its own From Date / To Date range — a file is
// "Active" whenever today falls between those two dates, for every file
// independently (not just a single hand-picked one).
function isFileActiveNow(row) {
  const todayKey = toDateKey(new Date());
  if (!row.fromDate || !row.toDate) return false;
  const from = toDateKey(row.fromDate);
  const to = toDateKey(row.toDate);
  if (!from || !to) return false;
  return todayKey >= from && todayKey <= to;
}

function FileNumberPanel() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ fileNo: "", fromDate: "", toDate: "" });
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);
  const now = useTick(30000); // recheck active status every 30s so it flips live as dates roll over

  const load = useCallback(() => { apiGet("/file-numbers").then(setRows).catch(e => setErr(e.message)); }, []);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    try {
      const active = isFileActiveNow(form);
      const body = { ...form, active, createdBy: "admin" };
      if (editId) await apiPut(`/file-numbers/${editId}`, body); else await apiPost("/file-numbers", body);
      setForm({ fileNo: "", fromDate: "", toDate: "" }); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  const displayRows = useMemo(() => rows.map(r => ({
    ...r,
    activeLabel: isFileActiveNow(r) ? "✅ Active" : "—",
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [rows, now]);

  return (
    <div>
      <h3 className="adm-setup-title"><Icon.fileno /> Document File No — every file's status is calculated automatically from its From Date / To Date, so more than one file can be active at the same time if their date ranges overlap</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-grid">
        <input className="adm-config-input" placeholder="File No" value={form.fileNo} onChange={e => setForm({ ...form, fileNo: e.target.value })} />
        <input type="date" className="adm-date-input" value={form.fromDate} onChange={e => setForm({ ...form, fromDate: e.target.value })} />
        <input type="date" className="adm-date-input" value={form.toDate} onChange={e => setForm({ ...form, toDate: e.target.value })} />
      </div>
      <div className="adm-setup-form-row">
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setForm({ fileNo: "", fromDate: "", toDate: "" }); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={displayRows}
        cols={[{ key: "id", label: "ID" }, { key: "fileNo", label: "File No" }, { key: "fromDate", label: "From" }, { key: "toDate", label: "To" }, { key: "activeLabel", label: "Status" }, { key: "createdBy", label: "Created By" }]}
        onEdit={r => { setEditId(r.id); setForm({ fileNo: r.fileNo || "", fromDate: r.fromDate || "", toDate: r.toDate || "" }); }}
        onDelete={id => apiDelete(`/file-numbers/${id}`).then(load)}
      />
    </div>
  );
}

function MasterSetupPanel() {
  const [tab, setTab] = useState("staff");
  return (
    <div>
      <h2 className="adm-title">Master Setup</h2>
      <p className="adm-subtitle">All 10 sections below save straight to the database and update in real time.</p>

      <div className="adm-setup-tabrow">
        {SETUP_TABS.map(t => (
          <button
            key={t.key}
            className={`adm-setup-tab-btn ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span className="adm-setup-tab-icon"><t.icon /></span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="adm-setup-panel-body">
        {tab === "staff" && <StaffPanel />}
        {tab === "users" && <UserAccountsPanel />}
        {tab === "division" && <DivisionPanel />}
        {["picker", "print", "check", "delivery", "filed"].includes(tab) && <OperatorPanel tabKey={tab} />}
        {tab === "jobcat" && <JobCategoryPanel />}
        {tab === "fileno" && <FileNumberPanel />}
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
      <h2 className="adm-title"><Icon.bell /> Notifications</h2>

      <SectionTitle>Open Picking Errors ({openErrors.length})</SectionTitle>
      {openErrors.length === 0 ? <div className="adm-notify-empty">None</div> : (
        <div className="adm-notify-list">
          {openErrors.map(d => (
            <div key={d.id} className="adm-notify-item error">
              Doc #{d.id} · {d.printDocumentNo || "No doc no"} — wrong material reported at Check
            </div>
          ))}
        </div>
      )}

      <SectionTitle>Overdue Deliveries (30+ days, {overdue.length})</SectionTitle>
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

// ── Report panel ──────────────────────────────────────────────────────────

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
  const [dateFieldMode, setDateFieldMode] = useState("start");
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
      <h2 className="adm-title">Report</h2>
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
        <span className="adm-xl-datefilter-label" style={{ whiteSpace: "nowrap" }}>{stageDates.label} date filter:</span>

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

// One job-type KPI card: total count + a live breakdown by division.
function JobTypeCard({ jobType, documents, divisions, operatorDivisionMap }) {
  const matching = documents.filter(d => (d.jobType || "").toLowerCase() === jobType.toLowerCase());
  const total = matching.length;

  const byDivision = divisions
    .map(div => ({
      label: `${div.divisionNo} — ${div.divisionName}`,
      count: matching.filter(d => docMatchesDivision(d, div.divisionNo, operatorDivisionMap)).length,
    }))
    .filter(row => row.count > 0);

  return (
    <div className="adm-kpi-card adm-jobtype-card">
      <div className="adm-kpi-label">{jobType}</div>
      <div className="adm-kpi-value">{total}</div>
      {byDivision.length > 0 && (
        <div className="adm-jobtype-divisions">
          {byDivision.map(row => (
            <div key={row.label} className="adm-jobtype-division-row">
              <span>{row.label}</span>
              <span>{row.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardPanel({ documents, jobTypes, divisions, operatorDivisionMap }) {
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

  return (
    <div>
      <h2 className="adm-title">Fentons Operation Efficiency Dashboard</h2>
      <p className="adm-subtitle">Live view, recalculates automatically as documents update.</p>

      <SectionTitle>Total Jobs by Job Type</SectionTitle>
      <div className="adm-kpi-row">
        <KpiCard label="Total Jobs" value={documents.length} colorClass="accent" />
        {jobTypes.map(jt => (
          <JobTypeCard
            key={jt}
            jobType={jt}
            documents={documents}
            divisions={divisions}
            operatorDivisionMap={operatorDivisionMap}
          />
        ))}
      </div>

      <SectionTitle>Total Jobs Issued Per Day / Portal</SectionTitle>
      <div className="adm-triple-row">
        <TripleStat title="Print Portal"    {...print} />
        <TripleStat title="Pick Portal"     {...pick} />
        <TripleStat title="Check Portal"    {...check} />
        <TripleStat title="Delivery Portal" {...delivery} />
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
        <EfficiencyTable title="Print Efficiency" rows={printEff} />
        <EfficiencyTable title="Picking Efficiency" rows={pickEff} />
        <EfficiencyTable title="Checking Efficiency" rows={checkEff} />
        <EfficiencyTable title="Delivery Efficiency" rows={deliveryEff} />
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [activeView, setActiveView] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [documents, setDocuments]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  const [range, setRange]       = useState("30D");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]     = useState("");
  const [operator, setOperator] = useState("ALL");

  // ── Division filter state ────────────────────────────────────────────
  const [division, setDivision] = useState("ALL");
  const [divisionsList, setDivisionsList] = useState([]);
  // name -> divisionNo, merged from the 4 operator master tables
  const [operatorDivisionMap, setOperatorDivisionMap] = useState({});

  // ── Job types now come straight from the Job Category master data —
  // add a category in Master Setup and it appears here automatically. ───
  const [jobCategories, setJobCategories] = useState([]);
  const jobTypes = useMemo(() => {
    const names = jobCategories.map(c => c.categoryName).filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [jobCategories]);

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

  // Divisions for the FilterBar dropdown.
  const fetchDivisions = useCallback(async () => {
    try {
      const list = await apiGet("/divisions");
      setDivisionsList(list);
    } catch (e) { /* non-fatal — filter just shows no divisions */ }
  }, []);

  // Job categories — drives the dashboard's "Total Jobs by Job Type" cards.
  const fetchJobCategories = useCallback(async () => {
    try {
      const list = await apiGet("/job-categories");
      setJobCategories(list);
    } catch (e) { /* non-fatal */ }
  }, []);

  // Build the name -> divisionNo lookup by merging Picker, Print, Check,
  // and Delivery operator master tables (same name across roles keeps
  // whichever division was fetched last — flag to us if that ever matters).
  const fetchOperatorDivisions = useCallback(async () => {
    try {
      const [pickers, printOps, checkOps, deliveryOps] = await Promise.all([
        apiGet("/pickers").catch(() => []),
        apiGet("/print-operators").catch(() => []),
        apiGet("/check-operators").catch(() => []),
        apiGet("/delivery-operators").catch(() => []),
      ]);
      const map = {};
      pickers.forEach(p => { if (p.pickerName && p.divisionNo) map[p.pickerName] = p.divisionNo; });
      printOps.forEach(p => { if (p.operatorName && p.divisionNo) map[p.operatorName] = p.divisionNo; });
      checkOps.forEach(p => { if (p.operatorName && p.divisionNo) map[p.operatorName] = p.divisionNo; });
      deliveryOps.forEach(p => { if (p.operatorName && p.divisionNo) map[p.operatorName] = p.divisionNo; });
      setOperatorDivisionMap(map);
    } catch (e) { /* non-fatal */ }
  }, []);

  useEffect(() => { fetchDocuments(false); }, [fetchDocuments]);
  useEffect(() => {
    const id = setInterval(() => fetchDocuments(true), AUTO_REFRESH);
    return () => clearInterval(id);
  }, [fetchDocuments]);

  useEffect(() => {
    fetchDivisions();
    fetchOperatorDivisions();
    fetchJobCategories();
    const id = setInterval(() => { fetchDivisions(); fetchOperatorDivisions(); fetchJobCategories(); }, AUTO_REFRESH * 5);
    return () => clearInterval(id);
  }, [fetchDivisions, fetchOperatorDivisions, fetchJobCategories]);

  const operators = useMemo(() => {
    const set = new Set();
    documents.forEach(d => docOperators(d).forEach(n => set.add(n)));
    return Array.from(set).sort();
  }, [documents]);

  const filtered = useMemo(() => {
    return documents.filter(d => {
      if (!inRange(d, range, fromDate, toDate)) return false;
      if (operator !== "ALL" && !docOperators(d).includes(operator)) return false;
      if (!docMatchesDivision(d, division, operatorDivisionMap)) return false;
      return true;
    });
  }, [documents, range, fromDate, toDate, operator, division, operatorDivisionMap]);

  const activeLabel = NAV_ITEMS.find(n => n.key === activeView)?.label || "Dashboard";

  return (
    <div className="adm-page">
      <Sidebar
        active={activeView}
        onSelect={setActiveView}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="adm-main">
        <div className="adm-topbar">
          <button
            className="adm-menu-btn"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
          <span className="adm-topbar-label">{activeLabel}</span>
        </div>

        {activeView === "dashboard" && (
          <>
            <FilterBar
              range={range} setRange={setRange}
              fromDate={fromDate} setFromDate={setFromDate}
              toDate={toDate} setToDate={setToDate}
              operator={operator} setOperator={setOperator}
              operators={operators}
              division={division} setDivision={setDivision}
              divisions={divisionsList}
            />

            {loading && <div className="adm-loading">Loading dashboard…</div>}
            {error && (
              <div className="adm-error">
                ⚠ {error} — <button onClick={() => fetchDocuments(false)}>retry</button>
              </div>
            )}
            {!loading && !error && (
              <DashboardPanel
                documents={filtered}
                jobTypes={jobTypes}
                divisions={divisionsList}
                operatorDivisionMap={operatorDivisionMap}
              />
            )}
          </>
        )}

        {activeView === "docentry"    && <DocumentForm />}
        {activeView === "print"       && <IssuePrintForm />}
        {activeView === "pick"        && <IssuPrint />}
        {activeView === "check"       && <IssueCheckForm />}
        {activeView === "delivery"    && <IssueDeliveryForm />}
        {activeView === "document"    && <ConfirmPortal />}
        {activeView === "fullreport"  && <DocumentsExcelPanel documents={documents} jobTypes={jobTypes} />}
        {activeView === "mastersetup" && <MasterSetupPanel />}
        {activeView === "notify"      && <NotificationPanel documents={documents} />}
        {activeView === "report"      && <ReportPanel documents={documents} jobTypes={jobTypes} />}
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
  document: ["id","requestedBy","vehicleNo","customerName","enteredBy","jobType","jobwbs",
    "requestDate","requestTime","reservationNo","status","createdDatetime",
    "deliveryConfirmed","deliveryConfirmedBy","deliveryConfirmTime",
    "cancelConfirmed","cancelConfirmedBy","cancelConfirmTime","reqId","fileNumber"],
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

const STAGE_DATE_FIELDS = {
  all:      { start: "requestDate",        hold: null,               label: "All" },
  document: { start: "requestDate",        hold: null,               label: "Document" },
  print:    { start: "printStartTime",     hold: "printHoldTime",    label: "Print" },
  pick:     { start: "startTime",          hold: "holdTime",         label: "Pick" },
  check:    { start: "checkStartTime",     hold: "checkHoldTime",    label: "Check" },
  delivery: { start: "deliveryStartTime",  hold: "deliveryHoldTime", label: "Delivery" },
};

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

  const [dateFieldMode, setDateFieldMode] = useState("start");
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
      <h2 className="adm-title">All Documents</h2>
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
            setDateFieldMode("start");
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
            const wb = XLSX.utils.book_new();
            jobTypes.forEach(t => {
              const typeRows = documents
                .filter(d => (d.jobType || "").toLowerCase() === t.toLowerCase())
                .map(d => {
                  const row = {};
                  cols.forEach(c => { row[c] = d[c] ?? ""; });
                  return row;
                });
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

      <div className="adm-xl-toolbar adm-xl-datefilter">
        <span className="adm-xl-datefilter-label">{stageDates.label} date filter:</span>

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
