import { useState, useEffect, useCallback, useMemo } from "react";
import "./AdminDashboard.css";
import * as XLSX from "xlsx";

// ── Portal pages (rendered inline when their sidebar item is selected) ─────
import IssuePrintForm    from "../Issue_Print_Portal/IssuePrintForm";
import IssuPrint         from "../Issue_Pick_Portal/IssuePickForm";
import IssueCheckForm    from "../Issue_Check_Portal/IssueCheckForm";
import IssueDeliveryForm from "../Issue_Delivery_Portal/IssueDeliveryForm";
import ConfirmPortal     from "../Confirm_Portal/ConfirmPortal";
// NOTE: AdminConfigCenter (old "usersetup" page) removed — replaced by
// MasterSetupPanel below, which now lives inside this same file and saves
// everything straight to the database through AdminSetupController.

// ── Config ───────────────────────────────────────────────────────────────
const MASTER_API   = "http://localhost:8080/api/print-portal";
const SETUP_API    = "http://localhost:8080/api/admin-setup";
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

// ── Sidebar ──────────────────────────────────────────────────────────────
// "System Config" and "User & Division Setup" removed — replaced by the
// single "Master Setup" entry, which contains all 10 buttons in one row.

const NAV_ITEMS = [
  { key: "dashboard",   label: "Dashboard",       icon: "📊" },
  { key: "print",       label: "Print Portal",    icon: "🖨️" },
  { key: "pick",        label: "Picking Portal",  icon: "📦" },
  { key: "check",       label: "Checking Portal", icon: "✅" },
  { key: "delivery",    label: "Delivery Portal", icon: "🚚" },
  { key: "document",    label: "Document Portal", icon: "📁" },
  { key: "fullreport",  label: "Full Report",     icon: "📊" },
  { key: "mastersetup", label: "Master Setup",    icon: "🧩" },
  { key: "notify",      label: "Notification",    icon: "🔔" },
  { key: "report",      label: "Report",          icon: "🗂️" },
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

// ── Filter bar ── (unchanged)

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

// ═══════════════════════════════════════════════════════════════════════
// ── MASTER SETUP PANEL — the 10 buttons in one row, all saving to the DB ──
// ═══════════════════════════════════════════════════════════════════════

// One shared fetch helper for every master-data endpoint.
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
  { key: "staff",    label: "1️⃣ Staff / User Character", icon: "🙋" },
  { key: "users",    label: "2️⃣ User Accounts",          icon: "🔐" },
  { key: "division", label: "Division",                   icon: "🏢" },
  { key: "picker",   label: "Picker",                      icon: "📦" },
  { key: "print",    label: "Document / Print",             icon: "🖨️" },
  { key: "check",    label: "Check",                        icon: "✅" },
  { key: "delivery", label: "Delivery",                     icon: "🚚" },
  { key: "filed",    label: "Filed",                        icon: "🗂️" },
  { key: "jobcat",   label: "Job Category",                 icon: "🏷️" },
  { key: "fileno",   label: "Document File No",             icon: "🔢" },
];

// Configuration for the 5 identical "name master" panels (Picker, Print/
// Document, Check, Delivery, Filed) — same UI, different endpoint/table,
// exactly as requested ("me pick,print,check,delvery,filing forms same UI").
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
      <h3 className="adm-setup-title">🙋 Staff / User Character — create names used across document entering, printing, picking, checking, delivering & filing</h3>
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

// ── 2) User Accounts panel (dropdown of staff + login + hashed password + forgot password) ──
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
      <h3 className="adm-setup-title">🔐 User Accounts — grants system / API login access (password stored hashed)</h3>
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
      <h3 className="adm-setup-title">🏢 Division</h3>
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

// ── Generic "operator" master panel — reused for Picker / Print / Check / Delivery / Filed ──
function OperatorPanel({ tabKey }) {
  const cfg = OPERATOR_PANEL_CONFIG[tabKey];
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ name: "", nic: "", nicName: "" });
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => { apiGet(cfg.path).then(setRows).catch(e => setErr(e.message)); }, [cfg.path]);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    try {
      const body = {
        [cfg.nameField]: form.name, [cfg.nicField]: form.nic, [cfg.nicNameField]: form.nicName, createdBy: "admin",
      };
      if (editId) await apiPut(`${cfg.path}/${editId}`, body); else await apiPost(cfg.path, body);
      setForm({ name: "", nic: "", nicName: "" }); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title">{cfg.nameLabel} Setup</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-grid">
        <input className="adm-config-input" placeholder={cfg.nameLabel} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input className="adm-config-input" placeholder="NIC" value={form.nic} onChange={e => setForm({ ...form, nic: e.target.value })} />
        <input className="adm-config-input" placeholder={cfg.nicNameLabel} value={form.nicName} onChange={e => setForm({ ...form, nicName: e.target.value })} />
      </div>
      <div className="adm-setup-form-row">
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setForm({ name: "", nic: "", nicName: "" }); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={rows}
        cols={[{ key: "id", label: "ID" }, { key: cfg.nameField, label: cfg.nameLabel }, { key: cfg.nicField, label: "NIC" }, { key: cfg.nicNameField, label: cfg.nicNameLabel }, { key: "createdBy", label: "Created By" }]}
        onEdit={r => { setEditId(r.id); setForm({ name: r[cfg.nameField] || "", nic: r[cfg.nicField] || "", nicName: r[cfg.nicNameField] || "" }); }}
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
      <h3 className="adm-setup-title">🏷️ Job Category</h3>
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

// ── Document File No panel (calendar from/to + single-active toggle) ────
function FileNumberPanel() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ fileNo: "", fromDate: "", toDate: "", active: false });
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => { apiGet("/file-numbers").then(setRows).catch(e => setErr(e.message)); }, []);
  useEffect(() => { load(); const id = setInterval(load, AUTO_REFRESH); return () => clearInterval(id); }, [load]);

  const submit = async () => {
    try {
      const body = { ...form, createdBy: "admin" };
      if (editId) await apiPut(`/file-numbers/${editId}`, body); else await apiPost("/file-numbers", body);
      setForm({ fileNo: "", fromDate: "", toDate: "", active: false }); setEditId(null); load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <h3 className="adm-setup-title">🔢 Document File No — only ONE active file is ever shown in the Filing Portal</h3>
      {err && <div className="adm-error">⚠ {err}</div>}
      <div className="adm-setup-form-grid">
        <input className="adm-config-input" placeholder="File No" value={form.fileNo} onChange={e => setForm({ ...form, fileNo: e.target.value })} />
        <input type="date" className="adm-date-input" value={form.fromDate} onChange={e => setForm({ ...form, fromDate: e.target.value })} />
        <input type="date" className="adm-date-input" value={form.toDate} onChange={e => setForm({ ...form, toDate: e.target.value })} />
        <label className="adm-setup-checkbox-label">
          <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active
        </label>
      </div>
      <div className="adm-setup-form-row">
        <button className="adm-config-add-btn" onClick={submit}>{editId ? "Update" : "+ Create"}</button>
        {editId && <button className="adm-xl-clear-btn" onClick={() => { setEditId(null); setForm({ fileNo: "", fromDate: "", toDate: "", active: false }); }}>Cancel</button>}
      </div>
      <SetupTable
        rows={rows.map(r => ({ ...r, active: r.active ? "✅ Active" : "—" }))}
        cols={[{ key: "id", label: "ID" }, { key: "fileNo", label: "File No" }, { key: "fromDate", label: "From" }, { key: "toDate", label: "To" }, { key: "active", label: "Status" }, { key: "createdBy", label: "Created By" }]}
        onEdit={r => { setEditId(r.id); setForm({ fileNo: r.fileNo || "", fromDate: r.fromDate || "", toDate: r.toDate || "", active: !!r.active && r.active !== "—" }); }}
        onDelete={id => apiDelete(`/file-numbers/${id}`).then(load)}
      />
    </div>
  );
}

function MasterSetupPanel() {
  const [tab, setTab] = useState("staff");
  return (
    <div>
      <h2 className="adm-title">🧩 Master Setup</h2>
      <p className="adm-subtitle">All 10 buttons below save straight to the database and update in real time.</p>

      <div className="adm-setup-tabrow">
        {SETUP_TABS.map(t => (
          <button
            key={t.key}
            className={`adm-setup-tab-btn ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span>{t.icon}</span> {t.label}
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

// ── System Config panel (unchanged — job types for Dashboard KPI cards) ──

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

// ── Report panel (unchanged from previous version) ───────────────────────

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
