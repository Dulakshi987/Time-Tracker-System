import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "./ConfirmPortal.css";
import { formatSriLankaTime } from "../../utils/dateUtils"; 
import {
  getCurrentUser, canAccessRoute, canUseButton, logoutUser,
  hasAllDivisionAccess, canSeeDivision,
} from "../../config/permissions";
// ⚠️ Adjust the path above ("../../config/permissions") to match where
//    permissions.js actually sits relative to this file.

// const DELIVERY_API = "http://localhost:8080/api/delivery-portal";
// const CONFIRM_API = "http://localhost:8080/api/issue-confirm";
// const SETUP_API = "http://localhost:8080/api/admin-setup";

const DELIVERY_API = "https://time-tracker-system-production.up.railway.app/api/delivery-portal";
const CONFIRM_API = "https://time-tracker-system-production.up.railway.app/api/issue-confirm";
const SETUP_API = "https://time-tracker-system-production.up.railway.app/api/admin-setup";
const AUTO_REFRESH = 10000;

// ── Date filter options — Today (Sri Lanka time, default) / All / Custom
// range. Same pattern as Print Portal / Pick Portal / Check Portal /
// Delivery Portal.
const DATE_FILTER_OPTIONS = [
  { value: "TODAY", label: "Today" },
  { value: "ALL", label: "All" },
  { value: "CUSTOM", label: "Custom" },
];

// ── Status filter options — clickable pill buttons (same look as the
// date filter buttons above). "filed" matches displayStatus(doc).cls,
// i.e. any document that has a File Number attached, regardless of
// whether it was Delivered or Cancelled underneath.
const STATUS_FILTER_OPTIONS = [
  { value: "ALL", label: "All Status" },
  { value: "completed", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "filed", label: "Filed" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d) { return d || "—"; }
function formatTime(t) { return t ? String(t).substring(0, 5) : "—"; }

function formatDateTime(dt) {
  if (!dt) return "—";
  // delegates to the shared Sri-Lanka-aware formatter — every call site in
  // this file (ViewDrawer's Print/Pick/Check/Delivery/Cancel sections, plus
  // the table's "Date / Time" column via eventInfo()) is fixed automatically.
  return formatSriLankaTime(dt);
}

function yn(v) {
  if (v === true || v === "YES" || v === "Yes" || v === "yes") return "Yes";
  if (v === false || v === "NO" || v === "No" || v === "no") return "No";
  return v || "—";
}

function jobTypeColor(jt) {
  const map = {
    balance:      "#a78bfa",
    domestic:     "#34d399",
    cost_center:  "#f59e0b",
    commercial:   "#3b82f6",
    sales_order:  "#f472b6",
  };
  return map[(jt || "").toLowerCase().replace(/\s+/g, "_")] || "#7c8db0";
}

function statusClass(s) {
  const v = (s || "").toLowerCase();
  if (v.includes("cancel"))   return "cancelled";
  if (v.includes("hold"))     return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("complete") || v.includes("done")) return "completed";
  return "pending";
}

function statusLabel(sc) {
  if (sc === "completed") return "Delivered";
  if (sc === "onhold")    return "Hold";
  if (sc === "cancelled") return "Cancelled";
  return sc;
}

function displayStatus(doc) {
  if (doc.fileNumber) return { label: "Filed", cls: "filed" };
  const sc = statusClass(doc.deliveryStatus);
  return { label: statusLabel(sc), cls: sc };
}

function computeRequestIds(documents) {
  const dateKeyOf = (doc) => {
    if (doc.requestDate)     return String(doc.requestDate).substring(0, 10);
    if (doc.createdDatetime) return String(doc.createdDatetime).substring(0, 10);
    return null;
  };

  const groups = {};
  documents.forEach(doc => {
    const key = dateKeyOf(doc) || "unknown";
    if (!groups[key]) groups[key] = [];
    groups[key].push(doc);
  });

  const idMap = {};
  Object.entries(groups).forEach(([key, group]) => {
    const compactDate = key === "unknown" ? "00000000" : key.replace(/-/g, "");
    group
      .slice()
      .sort((a, b) => {
        if (a.createdDatetime && b.createdDatetime) {
          return new Date(a.createdDatetime) - new Date(b.createdDatetime);
        }
        return a.id - b.id;
      })
      .forEach((doc, idx) => {
        idMap[doc.id] = `${compactDate}/${String(idx + 1).padStart(4, "0")}`;
      });
  });

  return idMap;
}

function eventInfo(doc) {
  const sc = statusClass(doc.deliveryStatus);
  if (sc === "completed") {
    return { dateTime: doc.deliveryEndTime, by: doc.deliveredBy, reason: null };
  }
  if (sc === "cancelled") {
    return { dateTime: doc.deliveryCancelTime, by: doc.deliveryCancelledBy, reason: doc.deliveryCancelReason };
  }
  return { dateTime: null, by: null, reason: null };
}

// ── Date filter helpers ──────────────────────────────────────────────────
// Returns today's date key (YYYY-MM-DD) in Sri Lanka time (UTC+5:30, no
// DST), regardless of what timezone the browser/server/device is actually
// running in. This is what "Today" always compares against, so the filter
// is correct no matter where the page is opened from. Mirrors the Print
// Portal / Pick Portal / Check Portal / Delivery Portal implementation
// exactly.
function getSriLankaTodayKey() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const colomboMs = utcMs + 5.5 * 60 * 60000;
  const colombo = new Date(colomboMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${colombo.getFullYear()}-${pad(colombo.getMonth() + 1)}-${pad(colombo.getDate())}`;
}

// requestDate is stored as a plain date (no time/timezone component), so a
// straight string comparison against YYYY-MM-DD keys is correct as-is.
function docDateKey(doc) {
  return doc.requestDate ? String(doc.requestDate).substring(0, 10) : null;
}

function matchesDateFilter(doc, mode, fromDate, toDate) {
  if (mode === "ALL") return true;

  const key = docDateKey(doc);

  if (mode === "TODAY") {
    return key === getSriLankaTodayKey();
  }

  if (mode === "CUSTOM") {
    if (!fromDate && !toDate) return true;
    if (!key) return false;
    if (fromDate && key < fromDate) return false;
    if (toDate && key > toDate) return false;
    return true;
  }

  return true;
}

async function fetchActiveFileNumber() {
  const res = await fetch(`${SETUP_API}/file-numbers`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const list = await res.json();
  const active = list.find(f => f.active === true || f.active === "true");
  return active ? active.fileNo : null;
}

// ── Add to File popup ───────────────────────────────────────────────────────

function AddFilePopup({ doc, reqId, activeFileNo, loadingFileNo, fileNoError, onConfirm, onCancel }) {
  const canConfirm = !!activeFileNo && !loadingFileNo;

  return (
    <div className="icf-popup-overlay">
      <div className="icf-popup" style={{ color: "#1a1a1a" }}>
        <div className="icf-popup-head" style={{ color: "#111" }}>
          <span style={{ color: "#111", fontWeight: 700 }}>📁 Add to File</span>
          <button className="icf-popup-close" onClick={onCancel} style={{ color: "#333" }}>✕</button>
        </div>
        <p className="icf-popup-sub" style={{ color: "#333" }}>
          {doc.printDocumentNo || `Doc #${doc.id}`} (Req ID: {reqId || "—"}) සඳහා
          admin විසින් setup කළ active file number එක auto-fill වේ
        </p>

        <div className="icf-popup-field">
          <span className="icf-popup-label" style={{ color: "#222", fontWeight: 600 }}>Active File Number</span>
          <input
            className="icf-popup-text-input"
            type="text"
            value={loadingFileNo ? "Loading..." : (activeFileNo || "")}
            readOnly
            placeholder="No active file number set by admin"
            style={{ color: "#111" }}
          />
        </div>

        {!loadingFileNo && fileNoError && (
          <div className="icf-error" style={{ marginTop: 8 }}>
            ⚠ Could not load active file number: {fileNoError}
          </div>
        )}
        {!loadingFileNo && !fileNoError && !activeFileNo && (
          <div className="icf-error" style={{ marginTop: 8 }}>
            ⚠ Admin has not marked any file number as Active yet in Master Setup → Document File No.
          </div>
        )}

        <div className="icf-popup-foot" style={{ justifyContent: "flex-end", gap: 12 }}>
          <button
            className="icf-btn icf-btn-outline"
            onClick={onCancel}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              border: "1.5px solid #94a3b8", background: "#fff",
              color: "#334155", fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            className="icf-btn-done"
            disabled={!canConfirm}
            onClick={() => onConfirm(activeFileNo)}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              background: "#7c3aed", color: "#fff", fontWeight: 600,
              border: "none", cursor: "pointer",
            }}
          >
            📁 Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit / Delete File popup ────────────────────────────────────────────────

function FileEditPopup({ doc, editValue, onEditValueChange, saving, onSave, onDelete, onCancel }) {
  return (
    <div className="icf-popup-overlay">
      <div className="icf-popup" style={{ color: "#1a1a1a" }}>
        <div className="icf-popup-head" style={{ color: "#111" }}>
          <span style={{ color: "#111", fontWeight: 700 }}>📁 Edit File Number</span>
          <button className="icf-popup-close" onClick={onCancel} style={{ color: "#333" }}>✕</button>
        </div>
        <p className="icf-popup-sub" style={{ color: "#333" }}>
          {doc.printDocumentNo || `Doc #${doc.id}`} — currently filed as{" "}
          <strong>{doc.fileNumber}</strong>
        </p>

        <div className="icf-popup-field">
          <span className="icf-popup-label" style={{ color: "#222", fontWeight: 600 }}>File Number</span>
          <input
            className="icf-popup-text-input"
            type="text"
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            placeholder="Enter file number"
            disabled={saving}
            style={{ color: "#111" }}
          />
        </div>

        <div className="icf-popup-foot" style={{ gap: 12 }}>
          <button
            className="icf-btn-danger"
            disabled={saving}
            onClick={onDelete}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              background: "#fee2e2", color: "#b91c1c", border: "1.5px solid #f87171",
              fontWeight: 600, cursor: "pointer",
            }}
          >
            🗑 Delete
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="icf-btn icf-btn-outline"
            disabled={saving}
            onClick={onCancel}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              border: "1.5px solid #94a3b8", background: "#fff",
              color: "#334155", fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            className="icf-btn-done"
            disabled={saving || !editValue.trim()}
            onClick={onSave}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              background: "#7c3aed", color: "#fff", fontWeight: 600,
              border: "none", cursor: "pointer",
            }}
          >
            {saving ? "Saving..." : "✓ Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Status popup (NO Delete button) ────────────────────────────────────

function StatusEditPopup({ doc, fields, onFieldChange, saving, onSave, onCancel }) {
  const sc = statusClass(doc.deliveryStatus);
  const isDelivered = sc === "completed";

  return (
    <div className="icf-popup-overlay">
      <div className="icf-popup" style={{ color: "#1a1a1a" }}>
        <div className="icf-popup-head" style={{ color: "#111" }}>
          <span style={{ color: "#111", fontWeight: 700 }}>
            {isDelivered ? "🚚 Edit Delivered Details" : "✕ Edit Cancelled Details"}
          </span>
          <button className="icf-popup-close" onClick={onCancel} style={{ color: "#333" }}>✕</button>
        </div>

        <p className="icf-popup-sub" style={{ color: "#333", marginBottom: 16 }}>
          {doc.printDocumentNo || `Doc #${doc.id}`}
        </p>

        {isDelivered ? (
          <div className="icf-popup-field">
            <span className="icf-popup-label" style={{ color: "#222", fontWeight: 600 }}>Delivered By</span>
            <input
              className="icf-popup-text-input"
              type="text"
              value={fields.deliveredBy}
              onChange={e => onFieldChange("deliveredBy", e.target.value)}
              placeholder="Enter name"
              disabled={saving}
              style={{ color: "#111" }}
            />
          </div>
        ) : (
          <>
            <div className="icf-popup-field">
              <span className="icf-popup-label" style={{ color: "#222", fontWeight: 600 }}>Cancelled By</span>
              <input
                className="icf-popup-text-input"
                type="text"
                value={fields.deliveryCancelledBy}
                onChange={e => onFieldChange("deliveryCancelledBy", e.target.value)}
                placeholder="Enter name"
                disabled={saving}
                style={{ color: "#111" }}
              />
            </div>
            <div className="icf-popup-field">
              <span className="icf-popup-label" style={{ color: "#222", fontWeight: 600 }}>Cancel Reason</span>
              <input
                className="icf-popup-text-input"
                type="text"
                value={fields.deliveryCancelReason}
                onChange={e => onFieldChange("deliveryCancelReason", e.target.value)}
                placeholder="Enter reason"
                disabled={saving}
                style={{ color: "#111" }}
              />
            </div>
          </>
        )}

        <div className="icf-popup-foot" style={{ justifyContent: "flex-end", gap: 12, marginTop: 20 }}>
          <button
            className="icf-btn icf-btn-outline"
            disabled={saving}
            onClick={onCancel}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              border: "1.5px solid #94a3b8", background: "#fff",
              color: "#334155", fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            className="icf-btn-done"
            disabled={saving}
            onClick={onSave}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              background: "#7c3aed", color: "#fff", fontWeight: 600,
              border: "none", cursor: "pointer",
            }}
          >
            {saving ? "Saving..." : "✓ Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View Drawer helpers ─────────────────────────────────────────────────────

function DetailRow({ label, value }) {
  return (
    <div className="icf-detail-row">
      <span className="icf-detail-label">{label}</span>
      <span className="icf-detail-value">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

function Section({ icon, title, children, accent }) {
  return (
    <div className={`icf-view-section ${accent ? `accent-${accent}` : ""}`}>
      <div className="icf-view-section-head">{icon} {title}</div>
      <div className="icf-view-section-body">{children}</div>
    </div>
  );
}

function ViewDrawer({ doc, reqId, onClose }) {
  const ds = displayStatus(doc);

  return (
    <div className="icf-drawer-overlay" onClick={onClose}>
      <div className="icf-drawer" onClick={e => e.stopPropagation()}>
        <div className="icf-drawer-head">
          <div>
            <span className="icf-drawer-title">📄 {doc.printDocumentNo ? doc.printDocumentNo : `Doc #${doc.id}`}</span>
            <span className={`icf-badge ${ds.cls}`} style={{ marginLeft: 10 }}>{ds.label}</span>
          </div>
          <button className="icf-popup-close" onClick={onClose}>✕</button>
        </div>

        <div className="icf-drawer-body">
          <Section icon="📝" title="Request Details">
            <DetailRow label="Req ID" value={doc.reqId || reqId} />
            <DetailRow label="Customer" value={doc.customerName} />
            <DetailRow label="Job Type" value={
              <span style={{ color: jobTypeColor(doc.jobType), fontWeight: 700 }}>{doc.jobType || "—"}</span>
            } />
            <DetailRow label="Job / WBS" value={doc.jobwbs} />
            <DetailRow label="Reservation No" value={doc.reservationNo} />
            <DetailRow label="Request Date" value={formatDate(doc.requestDate)} />
            <DetailRow label="Request Time" value={formatTime(doc.requestTime)} />
            <DetailRow label="Requested By" value={doc.requestedBy} />
            <DetailRow label="Request Vehicle No" value={doc.vehicleNo ? `🚐 ${doc.vehicleNo}` : "—"} />
            <DetailRow label="Entered By" value={doc.enteredBy} />
            <DetailRow label="Entered Date/Time" value={formatDateTime(doc.createdDatetime)} />
          </Section>

          <Section icon="🖨️" title="Print Details" accent="print">
            <DetailRow label="Print Status" value={doc.printStatus} />
            <DetailRow label="Print Document No" value={doc.printDocumentNo} />
            <DetailRow label="Printed By" value={doc.printedBy} />
            <DetailRow label="Print Start Time" value={formatDateTime(doc.printStartTime)} />
            <DetailRow label="Print End Time" value={formatDateTime(doc.printEndTime)} />
            <DetailRow label="Print Handover Time" value={formatDateTime(doc.printHandoverTime)} />
            <DetailRow label="Print Handed Over By" value={doc.PrintHandedOverBy} />
            {(doc.printHoldReason || doc.printHeldBy) && (
              <>
                <DetailRow label="Print Hold Reason" value={doc.printHoldReason} />
                <DetailRow label="Print Held By" value={doc.printHeldBy} />
                <DetailRow label="Print Hold Time" value={formatDateTime(doc.printHoldTime)} />
                <DetailRow label="Print Resume Time" value={formatDateTime(doc.printResumeTime)} />
              </>
            )}
          </Section>

          <Section icon="📦" title="Picking Details" accent="pick">
            <DetailRow label="Picked By" value={doc.pickedBy} />
            <DetailRow label="Pick Start Time" value={formatDateTime(doc.startTime)} />
            <DetailRow label="Pick End Time" value={formatDateTime(doc.endTime)} />
            {(doc.holdReason || doc.heldBy) && (
              <>
                <DetailRow label="Pick Hold Reason" value={doc.holdReason} />
                <DetailRow label="Pick Held By" value={doc.heldBy} />
                <DetailRow label="Pick Hold Time" value={formatDateTime(doc.holdTime)} />
                <DetailRow label="Pick Resume Time" value={formatDateTime(doc.resumeTime)} />
              </>
            )}
            {doc.emergencyPickResolved !== undefined && doc.emergencyPickResolved !== null && (
              <>
                <DetailRow label="Emergency Pick Resolved" value={yn(doc.emergencyPickResolved)} />
                <DetailRow label="Resolved By" value={doc.emergencyPickResolvedBy} />
                <DetailRow label="Resolved Time" value={formatDateTime(doc.emergencyResolvedTime)} />
              </>
            )}
          </Section>

          <Section icon="✅" title="Check Details" accent="check">
            <DetailRow label="Checked By" value={doc.checkedBy} />
            <DetailRow label="Check Start Time" value={formatDateTime(doc.checkStartTime)} />
            <DetailRow label="Check End Time" value={formatDateTime(doc.checkEndTime)} />
            {(doc.checkHoldReason || doc.checkHeldBy) && (
              <>
                <DetailRow label="Check Hold Reason" value={doc.checkHoldReason} />
                <DetailRow label="Check Held By" value={doc.checkHeldBy} />
                <DetailRow label="Check Hold Time" value={formatDateTime(doc.checkHoldTime)} />
                <DetailRow label="Check Resume Time" value={formatDateTime(doc.checkResumeTime)} />
              </>
            )}
            <div className="icf-view-subhead">⚠ Picking Error</div>
            <DetailRow label="Wrong Material" value={yn(doc.hasWrongMaterial)} />
            {(doc.hasWrongMaterial === "YES" || doc.hasWrongMaterial === true) && (
              <>
                <DetailRow label="Wrong Material SKU" value={doc.wrongMaterialSku} />
                <DetailRow label="Wrong Material Qty" value={doc.wrongMaterialQty} />
              </>
            )}
          </Section>

          <Section icon="🚚" title="Delivery Details" accent="delivery">
            <DetailRow label="Delivery Status" value={statusLabel(statusClass(doc.deliveryStatus))} />
            <DetailRow label="Delivery Start Time" value={formatDateTime(doc.deliveryStartTime)} />
            <DetailRow label="Delivery End Time" value={formatDateTime(doc.deliveryEndTime)} />
            <DetailRow label="Delivered By" value={doc.deliveredBy} />
            <DetailRow label="Delivery Vehicle No" value={doc.deliveryVehicleNo ? `🚐 ${doc.deliveryVehicleNo}` : "—"} />
            <DetailRow label="Delivery Confirmed" value={yn(doc.deliveryConfirmed)} />
            <DetailRow label="Delivery Confirmed By" value={doc.deliveryConfirmedBy} />
            <DetailRow label="Delivery Confirm Time" value={formatDateTime(doc.deliveryConfirmTime)} />
          </Section>

          {doc.deliveryCancelReason && (
            <Section icon="✕" title="Delivery Cancelled" accent="cancel">
              <DetailRow label="Cancel Reason" value={doc.deliveryCancelReason} />
              <DetailRow label="Cancelled By" value={doc.deliveryCancelledBy} />
              <DetailRow label="Cancelled At" value={formatDateTime(doc.deliveryCancelTime)} />
              <DetailRow label="Cancel Confirmed" value={yn(doc.cancelConfirmed)} />
              <DetailRow label="Cancel Confirmed By" value={doc.cancelConfirmedBy} />
              <DetailRow label="Cancel Confirm Time" value={formatDateTime(doc.cancelConfirmTime)} />
            </Section>
          )}

          <Section icon="📁" title="File Details" accent="file">
            <DetailRow label="Req ID" value={doc.reqId || reqId} />
            <DetailRow label="File Number" value={doc.fileNumber ? `📁 ${doc.fileNumber}` : "Not yet added to file"} />
          </Section>
        </div>

        <div className="icf-popup-foot">
          <button className="icf-drawer-close-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function IssueConfirm() {
  const navigate = useNavigate();

  // ── Auth / role guard ──
  const currentUser = getCurrentUser();

  useEffect(() => {
    if (!currentUser || !canAccessRoute(currentUser, "/confirm")) {
      navigate("/login", { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isAdminRole =
    currentUser?.staffName === "Admin" ||
    currentUser?.staffName === "System Administrator";

  const handleLogout = () => {
    logoutUser();
    navigate("/login", { replace: true });
  };

  const canManageDocs = canUseButton(currentUser, "edit") || canUseButton(currentUser, "delete");
  const visibleColumnCount = canManageDocs ? 12 : 11;

  const [documents,   setDocuments]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [filterStatus, setFilterStatus] = useState("ALL"); // "ALL" | "completed" | "cancelled" | "filed"
  const [filterDivision, setFilterDivision] = useState("ALL");
  const [search,      setSearch]      = useState("");
  const [searchField, setSearchField] = useState("ALL");
  const [savingId,    setSavingId]    = useState(null);
  const [viewDoc,     setViewDoc]     = useState(null);

  // ── Date filter — defaults to "Today" (Sri Lanka time). "All" clears
  // it, "Custom" opens a From/To range. Recomputes on every render (and
  // the auto-refresh timer keeps this component re-rendering), so at
  // midnight Colombo time "Today" automatically rolls over to the new
  // day without needing a page reload. Mirrors Print Portal / Pick Portal
  // / Check Portal / Delivery Portal.
  const [dateFilterMode, setDateFilterMode] = useState("TODAY"); // "TODAY" | "ALL" | "CUSTOM"
  const [fromDate,     setFromDate]     = useState("");
  const [toDate,       setToDate]       = useState("");

  // Add-to-File popup
  const [fileDoc,       setFileDoc]       = useState(null);
  const [activeFileNo,  setActiveFileNo]  = useState(null);
  const [loadingFileNo, setLoadingFileNo] = useState(false);
  const [fileNoError,   setFileNoError]   = useState(null);

  // Edit/Delete FILE popup
  const [editFileDoc,      setEditFileDoc]      = useState(null);
  const [editFileValue,    setEditFileValue]    = useState("");
  const [fileActionSaving, setFileActionSaving] = useState(false);

  // Edit STATUS popup
  const [editStatusDoc,      setEditStatusDoc]      = useState(null);
  const [statusFields,       setStatusFields]       = useState({ deliveredBy: "", deliveryCancelledBy: "", deliveryCancelReason: "" });
  const [statusActionSaving, setStatusActionSaving] = useState(false);

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(DELIVERY_API);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setDocuments(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchDocuments(false); }, [fetchDocuments]);
  useEffect(() => {
    const id = setInterval(() => fetchDocuments(true), AUTO_REFRESH);
    return () => clearInterval(id);
  }, [fetchDocuments]);

  const reqIdMap = useMemo(() => computeRequestIds(documents), [documents]);

  // ── Division-wise access scoping ──────────────────────────────────────
  // Admin / System Administrator (allDivisions: true) still see every
  // document. Every other role — including "Print with Document Enter" —
  // is hard-scoped to only the division(s) assigned to their User Account
  // (Master Setup → User Accounts → Division(s)), the same rule already
  // used on the Admin Dashboard. This runs BEFORE any status/search/date
  // filtering below, so a restricted user can never see another
  // division's documents no matter what they type in the search box.
  const divisionScopedDocuments = useMemo(() => {
    if (hasAllDivisionAccess(currentUser)) return documents;
    return documents.filter(d => canSeeDivision(currentUser, d.divisionNo));
  }, [documents, currentUser]);

  // Only Delivered + Cancelled
  const relevant = divisionScopedDocuments.filter(d => ["completed", "cancelled"].includes(statusClass(d.deliveryStatus)));

  // ── Division filter dropdown options — built from whatever divisions
  // actually appear in the documents this user is allowed to see (same
  // scoping rule as everything else on this page).
  const divisionOptions = useMemo(() => {
    const set = new Set();
    divisionScopedDocuments.forEach(d => { if (d.divisionNo) set.add(String(d.divisionNo)); });
    return Array.from(set).sort();
  }, [divisionScopedDocuments]);

  const visible = relevant.filter(doc => {
    const dsCls = displayStatus(doc).cls; // "completed" | "cancelled" | "filed"
    const matchStatus = filterStatus === "ALL" || dsCls === filterStatus;
    const matchDivision = filterDivision === "ALL" || String(doc.divisionNo || "") === String(filterDivision);

    const q = search.toLowerCase().trim();
    const reqId = (doc.reqId || reqIdMap[doc.id] || "").toLowerCase();

    // Field-specific search when a field is chosen; otherwise search everything.
    const fieldMap = {
      REQID: [reqId],
      DOCNO: [doc.printDocumentNo],
      RESERVATION: [doc.reservationNo],
    };

    const searchPool = searchField === "ALL"
      ? [
          reqId,
          doc.printDocumentNo,
          doc.reservationNo,
          doc.jobwbs,
          doc.customerName,
          doc.requestedBy,
          doc.deliveryVehicleNo,
          doc.deliveredBy,
          doc.deliveryCancelledBy,
          doc.fileNumber,
          String(doc.id),
        ]
      : (fieldMap[searchField] || []);

    const matchSearch = !q || searchPool.some(v => (v || "").toLowerCase().includes(q));

    const matchDate = matchesDateFilter(doc, dateFilterMode, fromDate, toDate);

    // Status filter, division filter, search filter and date filter all
    // combine — "All Status" / "All Divisions" simply mean that part of
    // the check always passes.
    return matchStatus && matchDivision && matchSearch && matchDate;
  });

  // Counts — scoped by the date filter too, so the chip numbers on screen
  // always match what's actually shown in the table below. Mirrors Print
  // Portal / Pick Portal / Check Portal / Delivery Portal.
  const dateScopedRelevant = useMemo(
    () => relevant.filter(doc => matchesDateFilter(doc, dateFilterMode, fromDate, toDate)),
    [relevant, dateFilterMode, fromDate, toDate]
  );

  const counts = {
    completed: dateScopedRelevant.filter(d => displayStatus(d).cls === "completed").length,
    cancelled: dateScopedRelevant.filter(d => displayStatus(d).cls === "cancelled").length,
    filed:     dateScopedRelevant.filter(d => displayStatus(d).cls === "filed").length,
  };

  const hasActiveToolbarFilters =
    search.trim() !== "" || filterStatus !== "ALL" || filterDivision !== "ALL";

  useEffect(() => {
    if (!viewDoc) return;
    const fresh = documents.find(d => d.id === viewDoc.id);
    if (fresh) setViewDoc(fresh);
  }, [documents]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add to File ──
  const handleAddToFileClick = async (doc) => {
    setFileDoc(doc);
    setActiveFileNo(null);
    setFileNoError(null);
    setLoadingFileNo(true);
    try {
      const fno = await fetchActiveFileNumber();
      setActiveFileNo(fno);
    } catch (err) {
      setFileNoError(err.message);
    } finally {
      setLoadingFileNo(false);
    }
  };

  const closeFilePopup = () => {
    setFileDoc(null);
    setActiveFileNo(null);
    setFileNoError(null);
  };

  const handleAddToFileConfirm = async (fileNumber) => {
    const doc = fileDoc;
    if (!doc || !fileNumber) return;
    closeFilePopup();
    setSavingId(doc.id);
    try {
      const res = await fetch(`${CONFIRM_API}/${doc.id}/add-to-file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reqId: reqIdMap[doc.id], fileNumber }),
      });
      if (res.status === 409) {
        await fetchDocuments(true);
        return;
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const updated = await res.json();
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
    } catch (err) {
      alert("Add to File failed: " + err.message);
    } finally {
      setSavingId(null);
    }
  };

  // ── File Edit / Delete ──
  const openFileEdit = (doc) => {
    setEditFileDoc(doc);
    setEditFileValue(doc.fileNumber || "");
  };

  const closeFileEdit = () => {
    setEditFileDoc(null);
    setEditFileValue("");
  };

  const handleSaveFileEdit = async () => {
    if (!editFileDoc || !editFileValue.trim()) return;
    setFileActionSaving(true);
    try {
      const res = await fetch(`${CONFIRM_API}/${editFileDoc.id}/edit-file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileNumber: editFileValue.trim() }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const updated = await res.json();
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
      closeFileEdit();
    } catch (err) {
      alert("Edit failed: " + err.message);
    } finally {
      setFileActionSaving(false);
    }
  };

  const handleDeleteFileNumber = async () => {
    if (!editFileDoc) return;
    if (!window.confirm(`Remove file number ${editFileDoc.fileNumber}? This document will go back to "not filed".`)) return;
    setFileActionSaving(true);
    try {
      const res = await fetch(`${CONFIRM_API}/${editFileDoc.id}/file`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const updated = await res.json();
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
      closeFileEdit();
    } catch (err) {
      alert("Delete failed: " + err.message);
    } finally {
      setFileActionSaving(false);
    }
  };

  // ── Status Edit ──
  const openStatusEdit = (doc) => {
    setEditStatusDoc(doc);
    setStatusFields({
      deliveredBy: doc.deliveredBy || "",
      deliveryCancelledBy: doc.deliveryCancelledBy || "",
      deliveryCancelReason: doc.deliveryCancelReason || "",
    });
  };

  const closeStatusEdit = () => {
    setEditStatusDoc(null);
    setStatusFields({ deliveredBy: "", deliveryCancelledBy: "", deliveryCancelReason: "" });
  };

  const handleStatusFieldChange = (key, value) => {
    setStatusFields(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveStatusEdit = async () => {
    if (!editStatusDoc) return;
    const sc = statusClass(editStatusDoc.deliveryStatus);
    const body = sc === "completed"
      ? { deliveredBy: statusFields.deliveredBy }
      : { deliveryCancelledBy: statusFields.deliveryCancelledBy, deliveryCancelReason: statusFields.deliveryCancelReason };

    setStatusActionSaving(true);
    try {
      const res = await fetch(`${CONFIRM_API}/${editStatusDoc.id}/edit-status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const updated = await res.json();
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
      closeStatusEdit();
    } catch (err) {
      alert("Edit failed: " + err.message);
    } finally {
      setStatusActionSaving(false);
    }
  };

  // Delete document (from Manage column)
  const handleDeleteDocument = async (doc) => {
    if (!doc) return;
    if (!window.confirm(`Permanently delete ${doc.printDocumentNo || `Doc #${doc.id}`}? This cannot be undone.`)) return;

    try {
      const res = await fetch(`${CONFIRM_API}/${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  // Manage → Edit
  const handleManageEdit = (doc) => {
    if (doc.fileNumber) {
      openFileEdit(doc);
    } else {
      openStatusEdit(doc);
    }
  };

  if (!currentUser || !canAccessRoute(currentUser, "/confirm")) {
    return null;
  }

  return (
    <div className="icf-page">

      {viewDoc && (
        <ViewDrawer
          doc={viewDoc}
          reqId={reqIdMap[viewDoc.id]}
          onClose={() => setViewDoc(null)}
        />
      )}

      {fileDoc && (
        <AddFilePopup
          doc={fileDoc}
          reqId={reqIdMap[fileDoc.id]}
          activeFileNo={activeFileNo}
          loadingFileNo={loadingFileNo}
          fileNoError={fileNoError}
          onConfirm={handleAddToFileConfirm}
          onCancel={closeFilePopup}
        />
      )}

      {editFileDoc && (
        <FileEditPopup
          doc={editFileDoc}
          editValue={editFileValue}
          onEditValueChange={setEditFileValue}
          saving={fileActionSaving}
          onSave={handleSaveFileEdit}
          onDelete={handleDeleteFileNumber}
          onCancel={closeFileEdit}
        />
      )}

      {editStatusDoc && (
        <StatusEditPopup
          doc={editStatusDoc}
          fields={statusFields}
          onFieldChange={handleStatusFieldChange}
          saving={statusActionSaving}
          onSave={handleSaveStatusEdit}
          onCancel={closeStatusEdit}
        />
      )}

      {/* Header */}
      <div className="ip-header">
        <div className="ip-header-left">
          <h1>LOGITRACK-WAREHOUSE TIME EFFICENCY TRACKER SYSTEM</h1>
          <h1>Issue Confirm Portal</h1>
          <p>
            Document Cart View
            {lastUpdated && (
              <span style={{ marginLeft: 10, fontSize: "0.75rem", color: "#3b82f6" }}>
                {refreshing ? "⟳ Refreshing..." : `Updated: ${lastUpdated.toLocaleTimeString()}`}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="ip-btn ip-btn-outline"
            style={{ flex: "unset", padding: "8px 18px" }}
            onClick={() => fetchDocuments(false)}
          >
            ↻ Refresh
          </button>
          {!isAdminRole && (
            <button
              className="ip-btn ip-btn-outline"
              style={{ flex: "unset", padding: "8px 18px", borderColor: "#ef4444", color: "#ef4444" }}
              onClick={handleLogout}
            >
              ⎋ Logout
            </button>
          )}
        </div>
      </div>

      {/* Toolbar — Search + clickable Status filter (Delivered / Cancelled /
          Filed) + Division No filter */}
      <div className="icf-date-toolbar">
        <div className="icf-search-wrap">
          <span className="icf-search-icon">🔍</span>
          <input
            className="icf-search"
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* <select
          className="icf-filter-select"
          value={searchField}
          onChange={e => setSearchField(e.target.value)}
          title="Choose which field the search box matches against"
        >
          <option value="ALL">Search: All Fields</option>
          <option value="REQID">Search: Req ID</option>
          <option value="DOCNO">Search: Doc No</option>
          <option value="RESERVATION">Search: Reservation No</option>
        </select> */}

        {STATUS_FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={`icf-filter-select icf-stat-chip-clickable ${filterStatus === opt.value ? "active" : ""}`}
            style={{ cursor: "pointer", fontWeight: filterStatus === opt.value ? 700 : 500 }}
            onClick={() => setFilterStatus(opt.value)}
          >
            {opt.label}
          </button>
        ))}

        <select
          className="icf-filter-select"
          value={filterDivision}
          onChange={e => setFilterDivision(e.target.value)}
          title="Filter by Division No"
        >
          <option value="ALL">All Divisions</option>
          {divisionOptions.map(dv => (
            <option key={dv} value={dv}>{dv}</option>
          ))}
        </select>

        {hasActiveToolbarFilters && (
          <button
            type="button"
            className="icf-btn icf-btn-outline"
            style={{ flex: "unset", padding: "8px 18px" }}
            onClick={() => { setSearch(""); setFilterStatus("ALL"); setFilterDivision("ALL"); }}
          >
            ✕ Clear
          </button>
        )}

        <div className="icf-stats">
          <div className="icf-stat-chip completed">Delivered <strong>{counts.completed}</strong></div>
          <div className="icf-stat-chip cancelled">Cancelled <strong>{counts.cancelled}</strong></div>
          <div className="icf-stat-chip filed">Filed <strong>{counts.filed}</strong></div>
          <div className="icf-stat-chip">Showing <strong style={{ color: "#a78bfa" }}>{visible.length}</strong></div>
        </div>
      </div>

      {/* ── Date filter — Today (Sri Lanka time, default) / All / Custom
          range. Same toolbar pattern as Print Portal / Pick Portal / Check
          Portal / Delivery Portal. ── */}
      <div className="icf-date-toolbar" style={{ marginTop: -6 }}>
        {DATE_FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={`icf-filter-select icf-stat-chip-clickable ${dateFilterMode === opt.value ? "active" : ""}`}
            style={{ cursor: "pointer", fontWeight: dateFilterMode === opt.value ? 700 : 500 }}
            onClick={() => setDateFilterMode(opt.value)}
          >
            {opt.label}
          </button>
        ))}

        {dateFilterMode === "CUSTOM" && (
          <>
            <input
              type="date"
              className="icf-filter-select"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
            />
            <span style={{ color: "#6c8bb3" }}>—</span>
            <input
              type="date"
              className="icf-filter-select"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
            />
            {(fromDate || toDate) && (
              <button
                type="button"
                className="icf-btn icf-btn-outline"
                style={{ flex: "unset", padding: "6px 14px" }}
                onClick={() => { setFromDate(""); setToDate(""); }}
              >
                ✕ Clear
              </button>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="icf-error">
          ⚠ {error} — <button onClick={() => fetchDocuments(false)}>retry</button>
        </div>
      )}

      {/* Table */}
      <div className="icf-table-wrap">
        <table className="icf-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Req ID</th>
              <th>Doc No</th>
              <th>Requested By</th>
              <th>Delivery Vehicle</th>
              <th>Delivered By</th>
              <th>Cancelled By</th>
              <th>Date / Time</th>
              <th>Job Type</th>
              <th>View</th>
              {canManageDocs && <th>Manage</th>}
              <th>File No.</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={visibleColumnCount} className="icf-empty-cell">Loading...</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={visibleColumnCount} className="icf-empty-cell">No documents found.</td></tr>
            ) : (
              visible.map(doc => {
                const sc = statusClass(doc.deliveryStatus);
                const info = eventInfo(doc);
                const ds = displayStatus(doc);
                const isFiled = !!doc.fileNumber;
                const reqId = doc.reqId || reqIdMap[doc.id] || "—";

                return (
                  <tr key={doc.id} className="icf-row">
                    <td>
                      <span
                        className={`icf-badge ${ds.cls}`}
                        style={{ cursor: "pointer" }}
                        title="Click to edit"
                        onClick={() => (isFiled ? openFileEdit(doc) : openStatusEdit(doc))}
                      >
                        {ds.label}
                      </span>
                    </td>

                    <td className="icf-td-reqid">{reqId}</td>

                    <td className="icf-td-docno">{doc.printDocumentNo || `Doc #${doc.id}`}</td>

                    <td>{doc.requestedBy || "—"}</td>

                    <td>🚐 {doc.deliveryVehicleNo || "—"}</td>

                    <td>{sc === "completed" ? `👤 ${info.by || "—"}` : "—"}</td>

                    <td>{sc === "cancelled" ? `👤 ${info.by || "—"}` : "—"}</td>

                    <td className="icf-td-datetime">{formatDateTime(info.dateTime)}</td>

                    <td>
                      <span style={{ color: jobTypeColor(doc.jobType), fontWeight: 600 }}>
                        {doc.jobType || "—"}
                      </span>
                    </td>

                    <td>
                      <button className="icf-btn-view" onClick={() => setViewDoc(doc)}>
                        👁 View
                      </button>
                    </td>

                    {canManageDocs && (
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            title="Edit"
                            onClick={() => handleManageEdit(doc)}
                            style={{
                              backgroundColor: "#3b82f6",
                              color: "#eaf2ff",
                              border: "1px solid #3b82f6",
                              minWidth: 34,
                              minHeight: 34,
                              fontSize: "1.05rem",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                          >
                            ✎
                          </button>
                          <button
                            title="Delete"
                            onClick={() => handleDeleteDocument(doc)}
                            style={{
                              backgroundColor: "#ef4444",
                              color: "#2a0a0a",
                              border: "1px solid #ef4444",
                              minWidth: 34,
                              minHeight: 34,
                              fontSize: "1.05rem",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    )}

                    <td>
                      {doc.fileNumber ? (
                        <span
                          className="icf-filenum"
                          style={{ cursor: "pointer" }}
                          title="Click to edit or delete this file entry"
                          onClick={() => openFileEdit(doc)}
                        >
                          📁 {doc.fileNumber}
                        </span>
                      ) : (
                        <button
                          className="icf-btn-addfile"
                          disabled={savingId === doc.id}
                          onClick={() => handleAddToFileClick(doc)}
                        >
                          {savingId === doc.id ? "Saving..." : "＋ Add to File"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
