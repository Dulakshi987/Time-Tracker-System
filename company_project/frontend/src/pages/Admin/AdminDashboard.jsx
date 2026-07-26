import { useState, useEffect, useCallback, useMemo } from "react";
import "./AdminDashboard.css";
import * as XLSX from "xlsx";

// ── Portal pages ───────────────────────────────────────────────────────────
import IssuePrintForm    from "../Issue_Print_Portal/IssuePrintForm";
import IssuPrint         from "../Issue_Pick_Portal/IssuePickForm";
import IssueCheckForm    from "../Issue_Check_Portal/IssueCheckForm";
import IssueDeliveryForm from "../Issue_Delivery_Portal/IssueDeliveryForm";
import ConfirmPortal     from "../Confirm_Portal/ConfirmPortal";
import DocumentForm      from "../Documents_Portal/DocumentForm";

// ── Config ─────────────────────────────────────────────────────────────────
const MASTER_API   = "https://time-tracker-system-production.up.railway.app/api/print-portal";
const SETUP_API    = "https://time-tracker-system-production.up.railway.app/api/admin-setup";
const AUTO_REFRESH = 1000;
const CONFIG_KEY   = "admin_job_types_config";

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

// ── Helpers ────────────────────────────────────────────────────────────────
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

function inRange(doc, range, fromDate, toDate) {
  const key = docDateKey(doc);
  if (range === "ALL") return true;
  if (!key) return false;
  const now = new Date();
  const todayKey = toDateKey(now);
  switch (range) {
    case "TODAY": return key === todayKey;
    case "7D": {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return key >= toDateKey(from) && key <= todayKey;
    }
    case "30D": {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      return key >= toDateKey(from) && key <= todayKey;
    }
    case "YEAR": return key.slice(0, 4) === String(now.getFullYear());
    case "CUSTOM":
      if (!fromDate && !toDate) return true;
      if (fromDate && key < fromDate) return false;
      if (toDate && key > toDate) return false;
      return true;
    default: return true;
  }
}

function docOperators(doc) {
  return [
    doc.requestedBy, doc.enteredBy, doc.printedBy, doc.PrintHandedOverBy,
    doc.printHandedOverBy, doc.pickedBy, doc.checkedBy, doc.deliveredBy,
  ].filter(Boolean);
}

function docMatchesDivision(doc, divisionNo, operatorDivisionMap) {
  if (!divisionNo || divisionNo === "ALL") return true;
  const names = [doc.printedBy, doc.pickedBy, doc.checkedBy, doc.deliveredBy].filter(Boolean);
  return names.some(n => operatorDivisionMap[n] === divisionNo);
}

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

// ── UI atoms ───────────────────────────────────────────────────────────────
function KpiCard({ label, value, colorClass, children }) {
  return (
    <div className="adm-kpi-card">
      <div className="adm-kpi-label">{label}</div>
      <div className={`adm-kpi-value ${colorClass || ""}`}>{value}</div>
      {children}
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

// ── Typewriter ─────────────────────────────────────────────────────────────
function useTypewriter(text, speed = 70) {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    setDisplayed("");
    if (!text) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return displayed;
}

// ── Icons ──────────────────────────────────────────────────────────────────
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
      <path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 13h5"/><path d="M12 15v-4"/>
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
};

// ── Sidebar ────────────────────────────────────────────────────────────────
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

function Sidebar({ active, onSelect, open, onClose, onLogout }) {
  return (
    <>
      {open && <div className="adm-sidebar-scrim" onClick={onClose} />}
      <div className={`adm-sidebar ${open ? "open" : ""}`} style={{ display: "flex", flexDirection: "column" }}>
        <div className="adm-sidebar-title">Fentons Admin</div>
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

        {/* Logout at bottom */}
        <div style={{ marginTop: "auto", padding: "16px 12px 20px" }}>
          <button
            onClick={() => {
              if (window.confirm("Are you sure you want to logout?")) {
                onLogout && onLogout();
              }
            }}
            className="adm-nav-btn"
            style={{
              width: "100%",
              background: "#fee2e2",
              color: "#b91c1c",
              border: "1px solid #fca5a5",
              fontWeight: 600,
            }}
          >
            <span className="adm-nav-icon">🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────────────
const RANGE_OPTIONS = [
  { key: "TODAY",  label: "Today" },
  { key: "7D",     label: "7 Days" },
  { key: "30D",    label: "30 Days" },
  { key: "YEAR",   label: "Year" },
  { key: "CUSTOM", label: "Custom" },
];

function FilterBar({
  range, setRange, fromDate, setFromDate, toDate, setToDate,
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

// ── API helpers ────────────────────────────────────────────────────────────
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

// ── Master Setup tabs ──────────────────────────────────────────────────────
const SETUP_TABS = [
  { key: "staff",    label: "Staff / User Character", icon: Icon.staff },
  { key: "users",    label: "User Accounts",          icon: Icon.users },
  { key: "division", label: "Division",               icon: Icon.division },
  { key: "picker",   label: "Picker",                 icon: Icon.picker },
  { key: "print",    label: "Document / Print",       icon: Icon.print },
  { key: "check",    label: "Check",                  icon: Icon.check },
  { key: "delivery", label: "Delivery",               icon: Icon.delivery },
  { key: "filed",    label: "Filed",                  icon: Icon.folder },
  { key: "jobcat",   label: "Job Category",           icon: Icon.category },
  { key: "fileno",   label: "Document File No",       icon: Icon.fileno },
];

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

// ── Staff Panel ────────────────────────────────────────────────────────────
function StaffPanel() {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    apiGet("/staff").then(setRows).catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    if (!name.trim()) return;
    try {
      const body = { name, createdBy: "admin" };
      if (editId) await apiPut(`/staff/${editId}`, body);
      else await apiPost("/staff", body);
      setName(""); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title"><Icon.staff /> Staff / User Character</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-row">
        <input className="adm-config-input" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setName(""); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={rows}
        cols={[{ key: "id", label: "ID" }, { key: "name", label: "Name" }]}
        onEdit={r => { setEditId(r.id); setName(r.name || ""); }}
        onDelete={async id => { if (window.confirm("Delete?")) { await apiDelete(`/staff/${id}`); load(); } }}
      />
    </div>
  );
}

// ── User Accounts Panel ────────────────────────────────────────────────────
function UsersPanel() {
  const [rows, setRows] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    apiGet("/users").then(setRows).catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    if (!username.trim() || !fullName.trim()) return;
    try {
      const body = { username, password, fullName, name: fullName };
      if (editId) await apiPut(`/users/${editId}`, body);
      else await apiPost("/users", body);
      setUsername(""); setPassword(""); setFullName(""); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title"><Icon.users /> User Accounts</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-row">
        <input className="adm-config-input" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
        <input className="adm-config-input" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <input className="adm-config-input" placeholder="Full Name" value={fullName} onChange={e => setFullName(e.target.value)} />
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setUsername(""); setPassword(""); setFullName(""); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={rows}
        cols={[
          { key: "id", label: "ID" },
          { key: "username", label: "Username" },
          { key: "fullName", label: "Full Name" },
        ]}
        onEdit={r => {
          setEditId(r.id);
          setUsername(r.username || "");
          setFullName(r.fullName || r.name || "");
          setPassword("");
        }}
        onDelete={async id => { if (window.confirm("Delete user?")) { await apiDelete(`/users/${id}`); load(); } }}
      />
    </div>
  );
}

// ── Division Panel ─────────────────────────────────────────────────────────
function DivisionPanel() {
  const [rows, setRows] = useState([]);
  const [divisionNo, setDivisionNo] = useState("");
  const [divisionName, setDivisionName] = useState("");
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    apiGet("/divisions").then(setRows).catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    if (!divisionNo.trim() || !divisionName.trim()) return;
    try {
      const body = { divisionNo, divisionName };
      if (editId) await apiPut(`/divisions/${editId}`, body);
      else await apiPost("/divisions", body);
      setDivisionNo(""); setDivisionName(""); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title"><Icon.division /> Division</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-row">
        <input className="adm-config-input" placeholder="Division No" value={divisionNo} onChange={e => setDivisionNo(e.target.value)} />
        <input className="adm-config-input" placeholder="Division Name" value={divisionName} onChange={e => setDivisionName(e.target.value)} />
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setDivisionNo(""); setDivisionName(""); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={rows}
        cols={[
          { key: "id", label: "ID" },
          { key: "divisionNo", label: "Division No" },
          { key: "divisionName", label: "Division Name" },
        ]}
        onEdit={r => { setEditId(r.id); setDivisionNo(r.divisionNo || ""); setDivisionName(r.divisionName || ""); }}
        onDelete={async id => { if (window.confirm("Delete?")) { await apiDelete(`/divisions/${id}`); load(); } }}
      />
    </div>
  );
}

// ── Generic Operator Panel (Picker / Print / Check / Delivery / Filed) ─────
function OperatorPanel({ configKey, divisions }) {
  const cfg = OPERATOR_PANEL_CONFIG[configKey];
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const [nic, setNic] = useState("");
  const [nicName, setNicName] = useState("");
  const [divisionNo, setDivisionNo] = useState("");
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    apiGet(cfg.path).then(setRows).catch(e => setErr(e.message));
  }, [cfg.path]);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    if (!name.trim()) return;
    try {
      const body = {
        [cfg.nameField]: name,
        [cfg.nicField]: nic,
        [cfg.nicNameField]: nicName,
        divisionNo,
      };
      if (editId) await apiPut(`${cfg.path}/${editId}`, body);
      else await apiPost(cfg.path, body);
      setName(""); setNic(""); setNicName(""); setDivisionNo(""); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title">{cfg.nameLabel}</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-row">
        <input className="adm-config-input" placeholder={cfg.nameLabel} value={name} onChange={e => setName(e.target.value)} />
        <input className="adm-config-input" placeholder="NIC" value={nic} onChange={e => setNic(e.target.value)} />
        <input className="adm-config-input" placeholder={cfg.nicNameLabel} value={nicName} onChange={e => setNicName(e.target.value)} />
        <select className="adm-config-input" value={divisionNo} onChange={e => setDivisionNo(e.target.value)}>
          <option value="">Select Division</option>
          {divisions.map(d => (
            <option key={d.divisionNo} value={d.divisionNo}>{d.divisionNo} — {d.divisionName}</option>
          ))}
        </select>
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setName(""); setNic(""); setNicName(""); setDivisionNo(""); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={rows}
        cols={[
          { key: "id", label: "ID" },
          { key: cfg.nameField, label: cfg.nameLabel },
          { key: cfg.nicField, label: "NIC" },
          { key: "divisionNo", label: "Division" },
        ]}
        onEdit={r => {
          setEditId(r.id);
          setName(r[cfg.nameField] || "");
          setNic(r[cfg.nicField] || "");
          setNicName(r[cfg.nicNameField] || "");
          setDivisionNo(r.divisionNo || "");
        }}
        onDelete={async id => { if (window.confirm("Delete?")) { await apiDelete(`${cfg.path}/${id}`); load(); } }}
      />
    </div>
  );
}

// ── Job Category Panel ─────────────────────────────────────────────────────
function JobCategoryPanel({ jobTypes, setJobTypes }) {
  const [newType, setNewType] = useState("");

  const add = () => {
    const t = newType.trim();
    if (!t || jobTypes.includes(t)) return;
    const next = [...jobTypes, t];
    setJobTypes(next);
    saveJobTypes(next);
    setNewType("");
  };

  const remove = (t) => {
    const next = jobTypes.filter(x => x !== t);
    setJobTypes(next);
    saveJobTypes(next);
  };

  return (
    <div>
      <h3 className="adm-setup-title"><Icon.category /> Job Category</h3>
      <div className="adm-setup-form-row">
        <input className="adm-config-input" placeholder="New Job Type" value={newType} onChange={e => setNewType(e.target.value)} />
        <button className="adm-config-add-btn" onClick={add}>+ Add</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        {jobTypes.map(t => (
          <div key={t} style={{
            background: "#e0e7ff", color: "#3730a3", padding: "6px 12px",
            borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
          }}>
            {t}
            <button onClick={() => remove(t)} style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", fontWeight: 700 }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Document File No Panel (Multiple Active allowed) ───────────────────────
function FileNoPanel() {
  const [rows, setRows] = useState([]);
  const [fileNo, setFileNo] = useState("");
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    apiGet("/file-numbers").then(setRows).catch(e => setErr(e.message));
  }, []);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    if (!fileNo.trim()) return;
    try {
      const body = { fileNo, active: false };
      if (editId) await apiPut(`/file-numbers/${editId}`, { ...body, active: rows.find(r => r.id === editId)?.active });
      else await apiPost("/file-numbers", body);
      setFileNo(""); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  // Toggle Active – multiple can be active at the same time
  const toggleActive = async (row) => {
    try {
      await apiPut(`/file-numbers/${row.id}`, { ...row, active: !row.active });
      load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title"><Icon.fileno /> Document File No (Multiple Active allowed)</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-row">
        <input className="adm-config-input" placeholder="File Number" value={fileNo} onChange={e => setFileNo(e.target.value)} />
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setFileNo(""); }}>Cancel</button>}
      </div>

      <div className="adm-xl-table-wrap" style={{ marginTop: 14 }}>
        <table className="adm-xl-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>File No</th>
              <th>Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="adm-eff-empty">No records yet</td></tr>
            ) : rows.map(r => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.fileNo}</td>
                <td>
                  <button
                    onClick={() => toggleActive(r)}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 6,
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 600,
                      background: r.active ? "#22c55e" : "#e2e8f0",
                      color: r.active ? "#fff" : "#64748b",
                    }}
                  >
                    {r.active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td>
                  <button className="adm-setup-edit-btn" onClick={() => { setEditId(r.id); setFileNo(r.fileNo || ""); }}>Edit</button>
                  <button className="adm-setup-del-btn" onClick={async () => {
                    if (window.confirm("Delete this file number?")) {
                      await apiDelete(`/file-numbers/${r.id}`);
                      load();
                    }
                  }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Master Setup Panel ─────────────────────────────────────────────────────
function MasterSetupPanel({ jobTypes, setJobTypes }) {
  const [tab, setTab] = useState("staff");
  const [divisions, setDivisions] = useState([]);

  useEffect(() => {
    apiGet("/divisions").then(setDivisions).catch(() => {});
  }, []);

  return (
    <div>
      <h2 className="adm-title">Master Setup</h2>
      <div className="adm-setup-tabs" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {SETUP_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`adm-range-btn ${tab === t.key ? "active" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <t.icon /> {t.label}
          </button>
        ))}
      </div>

      {tab === "staff"    && <StaffPanel />}
      {tab === "users"    && <UsersPanel />}
      {tab === "division" && <DivisionPanel />}
      {tab === "picker"   && <OperatorPanel configKey="picker" divisions={divisions} />}
      {tab === "print"    && <OperatorPanel configKey="print" divisions={divisions} />}
      {tab === "check"    && <OperatorPanel configKey="check" divisions={divisions} />}
      {tab === "delivery" && <OperatorPanel configKey="delivery" divisions={divisions} />}
      {tab === "filed"    && <OperatorPanel configKey="filed" divisions={divisions} />}
      {tab === "jobcat"   && <JobCategoryPanel jobTypes={jobTypes} setJobTypes={setJobTypes} />}
      {tab === "fileno"   && <FileNoPanel />}
    </div>
  );
}

// ── Dashboard Panel (dynamic Job Type cards + Division) ────────────────────
// ── Dashboard Panel (Division-wise Job Type + multiple active support already done) ──
function DashboardPanel({ documents, jobTypes, divisionsList }) {
  // Portal counts
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
  const filedCount = deliveredDocs.filter(d => d.fileNumber).length;
  const holdCount = documents.filter(d => deliveryStatusClass(d.deliveryStatus) === "onhold").length;
  const cancelledCount = documents.filter(d => deliveryStatusClass(d.deliveryStatus) === "cancelled").length;
  const pendingFileCount = deliveredDocs.length - filedCount;

  const printEff = operatorEfficiency(documents, "printedBy", "printDurationSeconds", d => printStatusClass(d.printStatus) === "completed");
  const pickEff = operatorEfficiency(documents, "pickedBy", "durationSeconds", d => pickStatusClass(d.status) === "completed");
  const checkEff = operatorEfficiency(documents, "checkedBy", "checkDurationSeconds", d => checkStatusClass(d.checkStatus) === "completed");
  const deliveryEff = operatorEfficiency(documents, "deliveredBy", "deliveryDurationSeconds", d => deliveryStatusClass(d.deliveryStatus) === "completed");

  // ── 1. Job Type cards (with Division under each) ──
  const jobTypeCounts = jobTypes.map(t => {
    const typeDocs = documents.filter(d => (d.jobType || "").toLowerCase() === t.toLowerCase());
    const divMap = {};
    typeDocs.forEach(d => {
      if (d.divisionNo) {
        const name = divisionsList.find(x => String(x.divisionNo) === String(d.divisionNo))?.divisionName || "";
        divMap[d.divisionNo] = name;
      }
    });
    return {
      type: t,
      count: typeDocs.length,
      divisions: Object.entries(divMap).map(([no, name]) => ({ no, name })),
    };
  });

  // ── 2. Division-wise Job Type matrix (all combinations) ──
  const divisionWise = divisionsList.map(div => {
    const divDocs = documents.filter(d => String(d.divisionNo) === String(div.divisionNo));
    const byJobType = jobTypes.map(jt => ({
      jobType: jt,
      count: divDocs.filter(d => (d.jobType || "").toLowerCase() === jt.toLowerCase()).length,
    }));
    return {
      divisionNo: div.divisionNo,
      divisionName: div.divisionName,
      total: divDocs.length,
      byJobType,
    };
  });

  return (
    <div>
      <h2 className="adm-title">Fentons Operation Efficiency Dashboard</h2>
      <p className="adm-subtitle">Live view • recalculates automatically</p>

      {/* ── Total + Job Type cards ── */}
      <SectionTitle>Total Jobs by Job Type</SectionTitle>
      <div className="adm-kpi-row" style={{ flexWrap: "wrap", gap: 14 }}>
        <KpiCard label="Total Jobs" value={documents.length} colorClass="accent" />
        {jobTypeCounts.map(jt => (
          <KpiCard key={jt.type} label={jt.type} value={jt.count}>
            {jt.divisions.length > 0 && (
              <div style={{ marginTop: 8, fontSize: "0.72rem", color: "#64748b", lineHeight: 1.45 }}>
                {jt.divisions.map(d => (
                  <div key={d.no}>
                    <strong>{d.no}</strong> — {d.name || "—"}
                  </div>
                ))}
              </div>
            )}
          </KpiCard>
        ))}
      </div>

      {/* ── NEW: Division-wise Job Type breakdown ── */}
      <SectionTitle>Division-wise Job Type Breakdown</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
        {divisionWise.map(div => (
          <div
            key={div.divisionNo}
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "16px 18px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "#1e293b", marginBottom: 4 }}>
              {div.divisionNo} — {div.divisionName}
            </div>
            <div style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: 12 }}>
              Total: <strong style={{ color: "#3b82f6" }}>{div.total}</strong>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {div.byJobType.map(jt => (
                <div
                  key={jt.jobType}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: jt.count > 0 ? "#f0f9ff" : "#f8fafc",
                    padding: "6px 10px",
                    borderRadius: 8,
                    fontSize: "0.82rem",
                  }}
                >
                  <span style={{ color: "#334155" }}>{jt.jobType}</span>
                  <span style={{
                    fontWeight: 700,
                    color: jt.count > 0 ? "#0369a1" : "#94a3b8",
                    minWidth: 28,
                    textAlign: "right",
                  }}>
                    {jt.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {divisionWise.length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
            No divisions found. Add divisions in Master Setup → Division.
          </div>
        )}
      </div>

      {/* ── Portal stats ── */}
      <SectionTitle>Total Jobs Issued Per Day / Portal</SectionTitle>
      <div className="adm-triple-row">
        <TripleStat title="Print Portal"    {...print} />
        <TripleStat title="Pick Portal"     {...pick} />
        <TripleStat title="Check Portal"    {...check} />
        <TripleStat title="Delivery Portal" {...delivery} />
      </div>

      {/* ── Filing status ── */}
      <SectionTitle>Document Filing Status</SectionTitle>
      <div className="adm-kpi-row">
        <KpiCard label="Delivered (Total)" value={deliveredDocs.length} colorClass="green" />
        <KpiCard label="Filed" value={filedCount} colorClass="accent" />
        <KpiCard label="Pending File" value={pendingFileCount} colorClass="orange" />
        <KpiCard label="On Hold" value={holdCount} colorClass="orange" />
        <KpiCard label="Cancelled" value={cancelledCount} colorClass="red" />
      </div>

      {/* ── Efficiency ── */}
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

// ── Notification Panel (simple placeholder) ────────────────────────────────
function NotificationPanel({ documents }) {
  const overdue = documents.filter(d => {
    const days = d.requestDate ? Math.floor((Date.now() - new Date(d.requestDate).getTime()) / 86400000) : 0;
    return days > 30 && deliveryStatusClass(d.deliveryStatus) !== "completed";
  });
  return (
    <div>
      <h2 className="adm-title">Notifications</h2>
      <p className="adm-subtitle">{overdue.length} document(s) pending more than 30 days</p>
      <ul>
        {overdue.slice(0, 50).map(d => (
          <li key={d.id}>{d.printDocumentNo || `Doc #${d.id}`} — {d.customerName}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Report Panel (simplified) ──────────────────────────────────────────────
function ReportPanel({ documents, jobTypes }) {
  return (
    <div>
      <h2 className="adm-title">Report</h2>
      <p className="adm-subtitle">Use Full Report for detailed Excel exports.</p>
    </div>
  );
}

// ── Excel helpers & Full Report Panel ──────────────────────────────────────
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

  const rows = useMemo(() => {
    return documents.filter(d => {
      if (jobTypeFilter !== "ALL" && (d.jobType || "").toLowerCase() !== jobTypeFilter.toLowerCase()) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = `${d.printDocumentNo || ""} ${d.customerName || ""} ${d.id}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [documents, jobTypeFilter, search]);

  const cols = PORTAL_COLUMNS[portalFilter] || PORTAL_COLUMNS.all;

  return (
    <div>
      <h2 className="adm-title">All Documents</h2>
      <div className="adm-xl-toolbar">
        <select className="adm-xl-select" value={jobTypeFilter} onChange={e => setJobTypeFilter(e.target.value)}>
          <option value="ALL">All Job Types</option>
          {jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="adm-xl-select" value={portalFilter} onChange={e => setPortalFilter(e.target.value)}>
          <option value="all">All Portals</option>
          <option value="print">Print</option>
          <option value="pick">Pick</option>
          <option value="check">Check</option>
          <option value="delivery">Delivery</option>
        </select>
        <input className="adm-xl-search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="adm-xl-export-btn" onClick={() => exportToExcel(rows, cols, portalFilter, portalFilter)}>
          ⬇ Export
        </button>
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

// ── Main AdminDashboard ────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [activeView, setActiveView] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [documents, setDocuments]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  const [range, setRange]       = useState("30D");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate]     = useState("");
  const [division, setDivision] = useState("ALL");
  const [divisionsList, setDivisionsList] = useState([]);
  const [operatorDivisionMap, setOperatorDivisionMap] = useState({});
  const [jobTypes, setJobTypes] = useState(loadJobTypes());

  // Logged-in full name (from User Accounts)
  const [loggedInFullName, setLoggedInFullName] = useState("Admin");
  const typedName = useTypewriter(loggedInFullName, 70);

  useEffect(() => {
    const username = localStorage.getItem("loggedInUsername") || "";
    if (!username) {
      setLoggedInFullName("Admin");
      return;
    }
    apiGet("/users")
      .then(list => {
        const user = list.find(u => (u.username || "").toLowerCase() === username.toLowerCase());
        setLoggedInFullName(user?.fullName || user?.name || username || "Admin");
      })
      .catch(() => setLoggedInFullName(username || "Admin"));
  }, []);

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

  const fetchDivisions = useCallback(async () => {
    try {
      const list = await apiGet("/divisions");
      setDivisionsList(list);
    } catch (e) {}
  }, []);

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
    } catch (e) {}
  }, []);

  useEffect(() => { fetchDocuments(false); }, [fetchDocuments]);
  useEffect(() => {
    const id = setInterval(() => fetchDocuments(true), AUTO_REFRESH);
    return () => clearInterval(id);
  }, [fetchDocuments]);

  useEffect(() => {
    fetchDivisions();
    fetchOperatorDivisions();
    const id = setInterval(() => { fetchDivisions(); fetchOperatorDivisions(); }, AUTO_REFRESH * 5);
    return () => clearInterval(id);
  }, [fetchDivisions, fetchOperatorDivisions]);

  const filtered = useMemo(() => {
    return documents.filter(d => {
      if (!inRange(d, range, fromDate, toDate)) return false;
      if (!docMatchesDivision(d, division, operatorDivisionMap)) return false;
      return true;
    });
  }, [documents, range, fromDate, toDate, division, operatorDivisionMap]);

  const activeLabel = NAV_ITEMS.find(n => n.key === activeView)?.label || "Dashboard";

  return (
    <div className="adm-page">
      <Sidebar
        active={activeView}
        onSelect={setActiveView}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={() => {
          localStorage.removeItem("loggedInUsername");
          localStorage.removeItem("token");
          window.location.href = "/login";
        }}
      />

      <div className="adm-main">
        <div className="adm-topbar">
          <button className="adm-menu-btn" aria-label="Open menu" onClick={() => setSidebarOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18"/>
            </svg>
          </button>
          <span className="adm-topbar-label">{activeLabel}</span>

          {/* Typewriter greeting */}
          <div style={{ marginLeft: "auto", fontWeight: 600, color: "#1e293b", fontSize: "0.95rem", display: "flex", alignItems: "center" }}>
            Hi&nbsp;<span style={{ color: "#3b82f6" }}>{typedName}</span>
            <span style={{
              animation: "blink 0.8s step-end infinite",
              color: "#3b82f6",
              marginLeft: 2,
            }}>|</span>
          </div>
        </div>

        {activeView === "dashboard" && (
          <>
            <FilterBar
              range={range} setRange={setRange}
              fromDate={fromDate} setFromDate={setFromDate}
              toDate={toDate} setToDate={setToDate}
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
                divisionsList={divisionsList}
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
        {activeView === "mastersetup" && <MasterSetupPanel jobTypes={jobTypes} setJobTypes={setJobTypes} />}
        {activeView === "notify"      && <NotificationPanel documents={documents} />}
        {activeView === "report"      && <ReportPanel documents={documents} jobTypes={jobTypes} />}
      </div>

      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}