import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "./IssueDelivery.css";
import { formatSriLankaTime } from "../../utils/dateUtils";
import {
  getCurrentUser,
  canAccessRoute,
  canUseButton,
  logoutUser,
  hasAllDivisionAccess,
  canSeeDivision,
  getUserDivisions,
} from "../../config/permissions";
// ⚠️ Adjust the path above ("../../config/permissions") to match where
//    permissions.js actually sits relative to this file.

// const API_BASE = "http://localhost:8080/api/delivery-portal";
// const SETUP_API = "http://localhost:8080/api/admin-setup";

const API_BASE = "https://time-tracker-system-production.up.railway.app/api/delivery-portal";
const SETUP_API = "https://time-tracker-system-production.up.railway.app/api/admin-setup";
// const AUTO_REFRESH = 10000;
const OPERATOR_REFRESH = 15000;

const HOLD_REASONS = [
  "Vehicle not available",
  "Customer not reachable",
  "Address issue",
  "Waiting for approval",
  "Other",
];

const CANCEL_REASONS = [
  "Customer rejected",
  "Wrong delivery address",
  "Order cancelled by customer",
  "Material damaged",
  "Other",
];

// ── Date filter options — Today (Sri Lanka time, default) / All / Custom
// range. Same pattern as Print Portal / Pick Portal / Check Portal.
const DATE_FILTER_OPTIONS = [
  { value: "TODAY", label: "Today" },
  { value: "ALL", label: "All" },
  { value: "CUSTOM", label: "Custom" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d) { return d || "—"; }
function formatTime(t) { return t ? String(t).substring(0, 5) : "—"; }

function formatDateTime(dt) {
  if (!dt) return "—";
  // now delegates to the shared Sri-Lanka-aware formatter — every call
  // site below (Print/Pick/Check/Delivery/Handover/Hold/Cancel sections
  // in ViewDrawer) picks up the fix automatically, no other lines change.
  return formatSriLankaTime(dt);
}

// Days are now always measured against the *request* date/time — this is
// when the customer originally raised the request, not when it was printed.
// The per-row "days pending" number always shows; only the ⚠ overdue
// highlight + banner kick in once it passes this threshold.
const OVERDUE_DAYS = 30;

function getRequestDateTime(doc) {
  if (!doc.requestDate) return null;
  const rawTime = (doc.requestTime || "00:00:00").trim();
  const parts = rawTime.split(":");
  const hh = (parts[0] || "0").padStart(2, "0");
  const mm = (parts[1] || "0").padStart(2, "0");
  const ss = (parts[2] || "0").padStart(2, "0");
  return `${doc.requestDate}T${hh}:${mm}:${ss}`;
}

function daysPending(doc) {
  const raw = getRequestDateTime(doc);
  let requested = raw ? new Date(raw) : null;

  if (!requested || isNaN(requested.getTime())) {
    if (doc.createdDatetime) requested = new Date(doc.createdDatetime);
  }
  if (!requested || isNaN(requested.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - requested.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

// ── Date filter helpers ──────────────────────────────────────────────────
// Returns today's date key (YYYY-MM-DD) in Sri Lanka time (UTC+5:30, no
// DST), regardless of what timezone the browser/server/device is actually
// running in. This is what "Today" always compares against, so the filter
// is correct no matter where the page is opened from. Mirrors the Print
// Portal / Pick Portal / Check Portal implementation exactly.
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

function statusLabel(s) {
  const c = statusClass(s);
  return {
    pending: "Pending",
    inprogress: "In Progress",
    onhold: "On Hold",
    completed: "Delivered",
    cancelled: "Cancelled",
  }[c];
}

// Color palette for status badges + action buttons. bg/text used for solid
// badges & active buttons, border used for outlined/inactive buttons.
const STATUS_COLORS = {
  pending:    { bg: "#f59e0b", text: "#1a1206", border: "#f59e0b" }, // amber
  inprogress: { bg: "#3b82f6", text: "#eaf2ff", border: "#3b82f6" }, // blue
  onhold:     { bg: "#fb923c", text: "#1a1206", border: "#fb923c" }, // orange
  completed:  { bg: "#22c55e", text: "#06210f", border: "#22c55e" }, // green
  cancelled:  { bg: "#ef4444", text: "#2a0a0a", border: "#ef4444" }, // red
};

function statusColor(s) {
  return STATUS_COLORS[statusClass(s)] || STATUS_COLORS.pending;
}

// Action button colors — Delivered / Hold / Cancel / Handover / Reactivate.
const ACTION_COLORS = {
  delivered:  { bg: "#22c55e", text: "#06210f" }, // green
  hold:       { bg: "#fb923c", text: "#1a1206" }, // orange
  cancel:     { bg: "#ef4444", text: "#2a0a0a" }, // red
  handover:   { bg: "#3b82f6", text: "#eaf2ff" }, // blue
  reactivate: { bg: "#a855f7", text: "#f4ecff" }, // purple
};

function yn(v) {
  if (v === true || v === "YES" || v === "Yes" || v === "yes") return "Yes";
  if (v === false || v === "NO" || v === "No" || v === "no") return "No";
  return v || "—";
}

// Same numbering scheme as the other portals — groups by request date,
// numbers within the day, e.g. 20260816/0001. Resets automatically when
// the date changes.
function computeRequestIds(documents) {
  const dateKeyOf = (doc) => {
    if (doc.requestDate) return String(doc.requestDate).substring(0, 10);
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
      .sort((a, b) => (a.createdDatetime && b.createdDatetime
        ? new Date(a.createdDatetime) - new Date(b.createdDatetime)
        : a.id - b.id))
      .forEach((doc, idx) => {
        idMap[doc.id] = `${compactDate}/${String(idx + 1).padStart(4, "0")}`;
      });
  });

  return idMap;
}

// ── Delivery operators — live from Master Setup (DB), division-aware ───────
// Returns the raw operator records (name + divisionNo) so callers can filter
// by whichever Division the current document belongs to — same pattern as
// the Pick Portal's division-scoped picker list.

function useDeliveryOperators() {
  const [operators, setOperators] = useState([]);

  const load = useCallback(() => {
    fetch(`${SETUP_API}/delivery-operators`)
      .then(res => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json();
      })
      .then(data => setOperators(Array.isArray(data) ? data : []))
      .catch(() => { /* keep last known list on transient errors */ });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, OPERATOR_REFRESH);
    return () => clearInterval(id);
  }, [load]);

  return operators;
}

// ── Generic Person Picker ──────────────────────────────────────────────────
function PersonPicker({ value, onChange, options }) {
  if (!options || options.length === 0) {
    return (
      <div className="ip-popup-options">
        <div className="ip-popup-empty">
          No delivery operators set up for this division yet. Add names in Admin Dashboard → Master Setup → Delivery.
        </div>
      </div>
    );
  }

  return (
    <div className="ip-popup-options">
      {options.map(name => (
        <button
          key={name}
          className={`ip-popup-option ${value === name ? "selected" : ""}`}
          onClick={() => onChange(name)}
        >
          👤 {name}
        </button>
      ))}
    </div>
  );
}

// ── Popup: Hold Reason + Held By ────────────────────────────────────────────

function HoldPopup({ operatorNames, onConfirm, onCancel }) {
  const [reason, setReason]   = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [heldBy, setHeldBy]   = useState("");

  const isOtherReason = reason === "Other";
  const finalReason   = isOtherReason ? otherReason.trim() : reason;
  const canConfirm    = !!finalReason && !!heldBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>⏸ Hold Delivery</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select a reason and who is putting this on hold</p>

        <span className="ip-popup-label">Hold Reason</span>
        <div className="ip-popup-options" style={{ marginBottom: 16 }}>
          {HOLD_REASONS.map(r => (
            <button
              key={r}
              className={`ip-popup-option ${reason === r ? "selected" : ""}`}
              onClick={() => setReason(r)}
            >
              {r === "Other" ? "✏️ " : "⏸ "}{r}
            </button>
          ))}
          {isOtherReason && (
            <input
              className="ip-popup-input"
              type="text"
              placeholder="Type reason..."
              value={otherReason}
              onChange={e => setOtherReason(e.target.value)}
              autoFocus
            />
          )}
        </div>

        <span className="ip-popup-label">Held By</span>
        <PersonPicker value={heldBy} onChange={setHeldBy} options={operatorNames} />

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-hold-confirm"
            disabled={!canConfirm}
            onClick={() => onConfirm(finalReason, heldBy)}
          >
            ⏸ Confirm Hold
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: Cancel Reason + Cancelled By ─────────────────────────────────────

function CancelPopup({ operatorNames, onConfirm, onCancel }) {
  const [reason, setReason]   = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [cancelledBy, setCancelledBy] = useState("");

  const isOtherReason = reason === "Other";
  const finalReason   = isOtherReason ? otherReason.trim() : reason;
  const canConfirm    = !!finalReason && !!cancelledBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>✕ Cancel Delivery</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select a reason and who is cancelling this delivery</p>

        <span className="ip-popup-label">Cancel Reason</span>
        <div className="ip-popup-options" style={{ marginBottom: 16 }}>
          {CANCEL_REASONS.map(r => (
            <button
              key={r}
              className={`ip-popup-option ${reason === r ? "selected" : ""}`}
              onClick={() => setReason(r)}
            >
              {r === "Other" ? "✏️ " : "✕ "}{r}
            </button>
          ))}
          {isOtherReason && (
            <input
              className="ip-popup-input"
              type="text"
              placeholder="Type reason..."
              value={otherReason}
              onChange={e => setOtherReason(e.target.value)}
              autoFocus
            />
          )}
        </div>

        <span className="ip-popup-label">Cancelled By</span>
        <PersonPicker value={cancelledBy} onChange={setCancelledBy} options={operatorNames} />

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Back</button>
          <button
            className="ip-btn ip-btn-cancel-confirm"
            disabled={!canConfirm}
            onClick={() => onConfirm(finalReason, cancelledBy)}
          >
            ✕ Confirm Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: Delivery Done (Delivered By) ──────────────────────────────────────

function DeliveryDonePopup({ operatorNames, onConfirm, onCancel }) {
  const [deliveredBy, setDeliveredBy] = useState("");
  const [vehicleNo, setVehicleNo]     = useState("");

  const canConfirm = !!deliveredBy && vehicleNo.trim().length > 0;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>✅ Delivery Done</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select who delivered this document</p>

        <span className="ip-popup-label">Delivered By</span>
        <div style={{ marginBottom: 16 }}>
          <PersonPicker value={deliveredBy} onChange={setDeliveredBy} options={operatorNames} />
        </div>

        <div className="ip-popup-field">
          <span className="ip-popup-label">Vehicle Number</span>
          <input
            className="ip-popup-text-input"
            type="text"
            placeholder="Enter vehicle number..."
            value={vehicleNo}
            onChange={e => setVehicleNo(e.target.value)}
          />
        </div>

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            disabled={!canConfirm}
            onClick={() => onConfirm(deliveredBy, vehicleNo.trim())}
          >
            Delivery Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: Handover (Handed Over By) ────────────────────────────────────────
// A document can be handed over only while it is On Hold or Cancelled.
// Once confirmed, Delivered / Hold / Cancel and the Delete button all lock
// for that row (see DocumentRow's isLocked).

function HandoverPopup({ operatorNames, onConfirm, onCancel }) {
  const [handoverBy, setHandoverBy] = useState("");
  const canConfirm = !!handoverBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>🤝 Handover</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select who is handing over this document</p>

        <span className="ip-popup-label">Handed Over By</span>
        <PersonPicker value={handoverBy} onChange={setHandoverBy} options={operatorNames} />

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            disabled={!canConfirm}
            onClick={() => onConfirm(handoverBy)}
          >
            🤝 Confirm Handover
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: Change (Request) Vehicle No ──────────────────────────────────────
function ChangeVehiclePopup({ doc, mode, onConfirm, onCancel }) {
  const isDelivery = mode === "delivery";
  const initialValue = isDelivery ? (doc.deliveryVehicleNo || "") : (doc.vehicleNo || "");
  const [vehicleNo, setVehicleNo] = useState(initialValue);
  const canConfirm = vehicleNo.trim().length > 0;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>Change {isDelivery ? "Delivery" : "Request"} Vehicle No</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">
          {isDelivery
            ? "Update the vehicle number recorded when this was marked Delivered"
            : "Update the vehicle number recorded against this request"}
        </p>

        <div className="ip-popup-field">
          <span className="ip-popup-label">Vehicle Number</span>
          <input
            className="ip-popup-text-input"
            type="text"
            placeholder="Enter vehicle number..."
            value={vehicleNo}
            onChange={e => setVehicleNo(e.target.value)}
            autoFocus
          />
        </div>

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            disabled={!canConfirm}
            onClick={() => onConfirm(vehicleNo.trim())}
          >
            Save Vehicle No
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: Edit (Held By / Cancelled By / Delivered By) ─────────────────────
function EditPopup({ doc, operatorNames, onConfirm, onCancel }) {
  const [heldBy, setHeldBy]           = useState(doc?.deliveryHeldBy || "");
  const [cancelledBy, setCancelledBy] = useState(doc?.deliveryCancelledBy || "");
  const [deliveredBy, setDeliveredBy] = useState(doc?.deliveredBy || "");

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>✏ Edit Document</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Update Held By, Cancelled By, or Delivered By</p>

        <span className="ip-popup-label">Held By</span>
        <PersonPicker value={heldBy} onChange={setHeldBy} options={operatorNames} />

        <span className="ip-popup-label" style={{ marginTop: 14, display: "block" }}>Cancelled By</span>
        <PersonPicker value={cancelledBy} onChange={setCancelledBy} options={operatorNames} />

        <span className="ip-popup-label" style={{ marginTop: 14, display: "block" }}>Delivered By</span>
        <PersonPicker value={deliveredBy} onChange={setDeliveredBy} options={operatorNames} />

        <div className="ip-popup-foot" style={{ marginTop: 18 }}>
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            onClick={() => onConfirm({ heldBy, cancelledBy, deliveredBy })}
          >
            💾 Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View Drawer helpers ──────────────────────────────────────────────────

function DetailRow({ label, value }) {
  return (
    <div className="ip-detail-row">
      <span className="ip-detail-label">{label}</span>
      <span className="ip-detail-value">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

function Section({ icon, title, children, accent }) {
  return (
    <div className={`ip-view-section ${accent ? `accent-${accent}` : ""}`}>
      <div className="ip-view-section-head">{icon} {title}</div>
      <div className="ip-view-section-body">{children}</div>
    </div>
  );
}

// ── Side Drawer: full document trail ─────────────────────────────────────

function ViewDrawer({ doc, divisionLabel, onClose, onChangeVehicle }) {
  const sc = statusClass(doc.deliveryStatus);
  const pending = daysPending(doc);
  const isOverdue = pending !== null && pending > OVERDUE_DAYS && sc !== "completed";

  return (
    <div className="ip-drawer-overlay" onClick={onClose}>
      <div className="ip-drawer" onClick={e => e.stopPropagation()}>
        <div className="ip-drawer-head">
          <div>
            <span className="ip-drawer-title">📄 {doc.printDocumentNo ? doc.printDocumentNo : `Doc #${doc.id}`}</span>
            <span className={`ip-badge ${sc}`} style={{ marginLeft: 10 }}>{statusLabel(doc.deliveryStatus)}</span>
          </div>
          <button className="ip-popup-close" onClick={onClose}>✕</button>
        </div>

        <div className="ip-drawer-body">

          {/* Request info */}
          <Section icon="" title="Request Details">
            <DetailRow label="Customer" value={doc.customerName} />
            <DetailRow label="Division" value={divisionLabel} />
            <DetailRow label="Job Type" value={
              <span style={{ color: jobTypeColor(doc.jobType), fontWeight: 700 }}>{doc.jobType || "—"}</span>
            } />
            <DetailRow label="Job / WBS" value={doc.jobwbs} />
            <DetailRow label="Reservation No" value={doc.reservationNo} />
            <DetailRow label="Request Date" value={formatDate(doc.requestDate)} />
            <DetailRow label="Request Time" value={formatTime(doc.requestTime)} />
            <DetailRow label="Requested By" value={doc.requestedBy} />
            <DetailRow label="Request Vehicle No" value={
              <span>
                 {doc.vehicleNo || "—"}{" "}
                <button className="ip-inline-edit-btn" onClick={() => onChangeVehicle(doc, "request")}> Change</button>
              </span>
            } />
            <DetailRow label="Days Pending" value={
              pending === null ? "—" : (
                <span className={`ip-pending-badge ${isOverdue ? "overdue" : ""}`}>
                  {isOverdue && "⚠ "}{pending} {pending === 1 ? "day" : "days"}
                </span>
              )
            } />
            <DetailRow label="Entered By" value={doc.enteredBy} />
            <DetailRow label="Entered Date/Time" value={formatDateTime(doc.createdDatetime)} />
          </Section>

          {/* Print trail */}
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

          {/* Picking trail */}
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

          {/* Check trail (incl. picking error) */}
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
            <div className="ip-view-subhead">⚠ Picking Error</div>
            <DetailRow label="Wrong Material" value={yn(doc.hasWrongMaterial)} />
            {(doc.hasWrongMaterial === "YES" || doc.hasWrongMaterial === true) && (
              <>
                <DetailRow label="Wrong Material SKU" value={doc.wrongMaterialSku} />
                <DetailRow label="Wrong Material Qty" value={doc.wrongMaterialQty} />
              </>
            )}
          </Section>

          {/* Delivery trail */}
          <Section icon="🚚" title="Delivery Details" accent="delivery">
            <DetailRow label="Delivery Status" value={statusLabel(doc.deliveryStatus)} />
            <DetailRow label="Delivery Start Time" value={formatDateTime(doc.deliveryStartTime)} />
            <DetailRow label="Delivery End Time" value={formatDateTime(doc.deliveryEndTime)} />
            <DetailRow label="Delivered By" value={doc.deliveredBy} />
            <DetailRow label="Delivery Vehicle No" value={
              <span>
                🚐 {doc.deliveryVehicleNo || "—"}{" "}
                <button className="ip-inline-edit-btn" onClick={() => onChangeVehicle(doc, "delivery")}>✏️ Change</button>
              </span>
            } />
            <DetailRow label="Delivery Confirmed" value={yn(doc.deliveryConfirmed)} />
            <DetailRow label="Delivery Confirmed By" value={doc.deliveryConfirmedBy} />
            <DetailRow label="Delivery Confirm Time" value={formatDateTime(doc.deliveryConfirmTime)} />
          </Section>

          {/* Handover info */}
          {(doc.handoverBy || doc.handoverTime) && (
            <Section icon="🤝" title="Handover" accent="delivery">
              <DetailRow label="Handed Over By" value={doc.handoverBy} />
              <DetailRow label="Handover Time" value={formatDateTime(doc.handoverTime)} />
            </Section>
          )}

          {/* Hold info */}
          {(sc === "onhold" || doc.deliveryHoldReason) && (
            <Section icon="⏸" title="Delivery Hold" accent="hold">
              <DetailRow label="Hold Reason" value={doc.deliveryHoldReason} />
              <DetailRow label="Held By" value={doc.deliveryHeldBy} />
              <DetailRow label="Held At" value={formatDateTime(doc.deliveryHoldTime)} />
              <DetailRow label="Resume Time" value={formatDateTime(doc.deliveryResumeTime)} />
            </Section>
          )}

          {/* Cancel info */}
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

        </div>

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Table Row ─────────────────────────────────────────────────────────────
// Locking rule: once a document is Delivered, put On Hold, Cancelled, or
// Handed Over, the Delivered / Hold / Cancel action buttons AND the Delete
// button all lock (become non-clickable) for that row.
//
// Handover rule: Handover is only clickable while the row's status is
// On Hold or Cancelled — and only if it hasn't already been handed over.
// For every other status (Pending, In Progress, Delivered) the Handover
// button stays disabled, while Hold / Cancel / Delivered remain normally
// clickable.
//
// Reactivate rule (NEW): once Handover is confirmed, the same button
// automatically switches into a "Reactivate" button (still clickable, in
// purple). Clicking Reactivate clears the handover + unlocks the row again,
// so Delivered / Hold / Cancel / Delete all become clickable once more.

function DocumentRow({ doc, requestId, divisionLabel, canManage, canHandover: canHandoverAccess, onView, onDelivered, onHold, onCancelled, onHandover, onReactivate, onEdit, onDelete }) {
  const sc = statusClass(doc.deliveryStatus);
  const isHandedOver = !!doc.handoverBy;

  const isLocked = sc === "completed" || sc === "onhold" || sc === "cancelled" || isHandedOver;

  // Handover enabled ONLY when On Hold or Cancelled (and not already handed over).
  const canHandover = (sc === "onhold" || sc === "cancelled") && !isHandedOver;
  const lockedTitle = "Locked — Hold / Cancelled / Delivered / Handed Over";

  const pending = daysPending(doc);
  const isOverdue = pending !== null && pending > OVERDUE_DAYS && sc !== "completed";
  const sColor = statusColor(doc.deliveryStatus);

  const actionBtnStyle = (key, isActive, disabled) => {
    const c = ACTION_COLORS[key];
    if (disabled) return { opacity: 0.35, cursor: "not-allowed" };
    return isActive
      ? { backgroundColor: c.bg, color: c.text, borderColor: c.bg }
      : { borderColor: c.bg, color: c.bg };
  };

  return (
    <tr className={`ip-row status-${sc} ${isOverdue ? "overdue" : ""}`}>
      <td className="ip-td-id">{requestId || "—"}</td>
      <td className="ip-td-division">{divisionLabel || "—"}</td>
      <td className="ip-td-wbs" title={doc.jobwbs || ""}>{doc.jobwbs || "—"}</td>
      <td className="ip-td-docno">{doc.printDocumentNo ? doc.printDocumentNo : `Doc #${doc.id}`}</td>
      <td>{doc.customerName || "—"}</td>
      <td className="ip-td-datetime">
        {formatDate(doc.requestDate)} <span className="ip-td-time">{formatTime(doc.requestTime)}</span>
      </td>
      <td className="ip-td-requested">
        <div>{doc.requestedBy || "—"}</div>
        <div className="ip-td-vehicle">🚐 {doc.vehicleNo || "—"}</div>
      </td>
      <td className="ip-td-requested">
        <div className="ip-td-vehicle">🚐 {doc.deliveryVehicleNo || "—"}</div>
      </td>
      <td>
        {pending === null ? "—" : (
          <span className={`ip-pending-badge ${isOverdue ? "overdue" : ""}`}>
            {isOverdue && "⚠ "}{pending} {pending === 1 ? "day" : "days"}
          </span>
        )}
      </td>
      <td>
        <span
          className={`ip-badge ${sc}`}
          style={{ backgroundColor: sColor.bg, color: sColor.text, borderColor: sColor.border }}
        >
          {statusLabel(doc.deliveryStatus)}
        </span>
      </td>
      <td>
        <button className="ip-btn-view" onClick={() => onView(doc)}>👁 View</button>
      </td>
      {canManage && (
        <td>
          <div className="ip-row-manage" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="ip-mini-manage ip-mini-edit"
              title="Edit"
              onClick={() => onEdit(doc)}
              style={{
                backgroundColor: "#3b82f6",
                color: "#eaf2ff",
                borderColor: "#3b82f6",
                minWidth: 34,
                minHeight: 34,
                fontSize: "1.05rem",
                borderRadius: 8,
              }}
            >
              ✎
            </button>
            <button
              className="ip-mini-manage ip-mini-delete"
              title={isLocked ? lockedTitle : "Delete"}
              disabled={isLocked}
              onClick={() => onDelete(doc.id)}
              style={
                isLocked
                  ? { opacity: 0.35, cursor: "not-allowed", backgroundColor: "#3a1010", color: "#ef4444", borderColor: "#ef4444", minWidth: 34, minHeight: 34, fontSize: "1.05rem", borderRadius: 8 }
                  : { backgroundColor: "#ef4444", color: "#2a0a0a", borderColor: "#ef4444", minWidth: 34, minHeight: 34, fontSize: "1.05rem", borderRadius: 8 }
              }
            >
              🗑
            </button>
          </div>
        </td>
      )}
      <td>
        <div className="ip-row-actions">
          <button
            className={`ip-mini-btn ip-mini-end ${sc === "completed" ? "active" : ""}`}
            disabled={isLocked}
            title={isLocked ? lockedTitle : "Delivered"}
            onClick={() => onDelivered(doc.id)}
            style={actionBtnStyle("delivered", sc === "completed", isLocked)}
          >
            ✅
          </button>
          <button
            className={`ip-mini-btn ip-mini-hold ${sc === "onhold" ? "active" : ""}`}
            disabled={isLocked}
            title={isLocked ? lockedTitle : "Hold"}
            onClick={() => onHold(doc.id)}
            style={actionBtnStyle("hold", sc === "onhold", isLocked)}
          >
            ⏸
          </button>
          <button
            className={`ip-mini-btn ip-mini-cancel ${sc === "cancelled" ? "active" : ""}`}
            disabled={isLocked}
            title={isLocked ? lockedTitle : "Cancelled"}
            onClick={() => onCancelled(doc.id)}
            style={actionBtnStyle("cancel", sc === "cancelled", isLocked)}
          >
            ✕
          </button>
        </div>
      </td>
      {canHandoverAccess && (
        <td className="ip-td-handover">
          {isHandedOver ? (
            <button
              className="ip-mini-btn ip-mini-handover ip-mini-btn-standalone active"
              title={`Handed over by ${doc.handoverBy} — click to reactivate`}
              onClick={() => onReactivate(doc.id)}
              style={{ backgroundColor: ACTION_COLORS.reactivate.bg, color: ACTION_COLORS.reactivate.text, borderColor: ACTION_COLORS.reactivate.bg }}
            >
              <span className="ip-handover-icon">🔄</span>
              <span className="ip-handover-label">Reactivate</span>
            </button>
          ) : (
            <button
              className="ip-mini-btn ip-mini-handover ip-mini-btn-standalone"
              disabled={!canHandover}
              title={canHandover ? "Handover" : "Handover available only after Hold or Cancel"}
              onClick={() => onHandover(doc.id)}
              style={canHandover
                ? { borderColor: ACTION_COLORS.handover.bg, color: ACTION_COLORS.handover.bg }
                : { opacity: 0.35, cursor: "not-allowed" }}
            >
              <span className="ip-handover-icon">🤝</span>
              <span className="ip-handover-label">Handover</span>
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

// ── Skeleton Row ─────────────────────────────────────────────────────────────

const COLUMN_COUNT = 14;

function SkeletonRow({ columnCount }) {
  return (
    <tr className="ip-row">
      {Array.from({ length: columnCount }).map((_, i) => (
        <td key={i}>
          <div className="ip-skeleton" style={{ width: "80%", height: 12 }} />
        </td>
      ))}
    </tr>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function IssueDeliveryForm() {
  const navigate = useNavigate();

  // ── Auth / role guard ──
  // Redirects to /login if there's no logged-in user, or the logged-in
  // user's role isn't allowed on the /delivery route (see permissions.js).
  const currentUser = getCurrentUser();

  useEffect(() => {
    if (!currentUser || !canAccessRoute(currentUser, "/delivery")) {
      navigate("/login", { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Admin / System Administrator already have logout available elsewhere
  // (their own dashboard/navbar) — hide the in-portal Logout button for them.
  const isAdminRole =
    currentUser?.staffName === "Admin" ||
    currentUser?.staffName === "System Administrator";

  const handleLogout = () => {
    logoutUser();
    navigate("/login", { replace: true });
  };

  // ── Division access ──
  // Admin / System Administrator (allDivisions: true in permissions.js) see
  // every division. Every other login only sees documents whose divisionNo
  // matches the division(s) assigned to their account in Master Setup
  // (User Accounts → divisionNo, comma-separated for multi-division staff).
  const hasAllDiv = hasAllDivisionAccess(currentUser);
  const userDivisions = useMemo(() => getUserDivisions(currentUser), [currentUser]);

  // Manage (Edit/Delete) + Handover columns — Admin / System Administrator only.
  // Every other login never sees these two columns, regardless of their
  // ROLE_ACCESS.buttons list.
  const canManageDocs = isAdminRole;
  const canHandoverAccess = isAdminRole;
  const visibleColumnCount = COLUMN_COUNT - (canManageDocs ? 0 : 1) - (canHandoverAccess ? 0 : 1);

  const [documents,    setDocuments]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [search,       setSearch]       = useState("");
  const [filterType,   setFilterType]   = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterDivision, setFilterDivision] = useState("ALL"); // Division filter — mirrors Job Type dropdown
  const [statFilter,   setStatFilter]   = useState("ALL"); // ALL | pending | onhold | completed | cancelled — driven by the stat chips
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const [refreshing,   setRefreshing]   = useState(false);

  // ── Date filter — defaults to "Today" (Sri Lanka time). "All" clears
  // it, "Custom" opens a From/To range. Recomputes on every render (and
  // the auto-refresh timer keeps this component re-rendering), so at
  // midnight Colombo time "Today" automatically rolls over to the new
  // day without needing a page reload. Mirrors Print Portal / Pick Portal
  // / Check Portal.
  const [dateFilterMode, setDateFilterMode] = useState("TODAY"); // "TODAY" | "ALL" | "CUSTOM"
  const [fromDate,     setFromDate]     = useState("");
  const [toDate,       setToDate]       = useState("");

  // Divisions (Admin Master Data) — used to label each row/card and to
  // scope which delivery operators show up in the popups below.
  const [divisions, setDivisions] = useState([]);

  // Delivery operator names — live from Admin Dashboard → Master Setup →
  // Delivery (DB), kept as raw records so they can be filtered by division.
  const deliveryOperators = useDeliveryOperators();

  const [activePopup,  setActivePopup]  = useState(null); // "hold" | "delivered" | "cancel" | "handover" | "vehicle" | "edit" | null
  const [activeId,     setActiveId]     = useState(null);
  const [vehicleDoc,   setVehicleDoc]   = useState(null);
  const [vehicleMode,  setVehicleMode]  = useState("request"); // "request" | "delivery"
  const [viewDoc,      setViewDoc]      = useState(null);

  // ── Fetch — only Check Done documents come back from this endpoint ──
  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res  = await fetch(API_BASE);
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

  const fetchDivisions = useCallback(async () => {
    try {
      const res = await fetch(`${SETUP_API}/divisions`);
      if (res.ok) {
        const data = await res.json();
        setDivisions(data || []);
      }
    } catch (e) {
      console.warn("Failed to load divisions", e);
    }
  }, []);

  const divisionNoToName = useMemo(() => {
    const map = {};
    divisions.forEach(d => { map[d.divisionNo] = d.divisionName; });
    return map;
  }, [divisions]);

  const divisionLabelFor = useCallback((doc) => (
    doc?.divisionNo ? `${doc.divisionNo} — ${divisionNoToName[doc.divisionNo] || ""}` : null
  ), [divisionNoToName]);

  // Division-scoped operator names — only the names added under that
  // specific Division in Admin Master Setup → Delivery.
  const getOperatorNamesForDivision = useCallback((divisionNo) => {
    if (!divisionNo) return [];
    return deliveryOperators
      .filter(p => {
        const pDivisionNo = p.divisionNo || (p.division && p.division.divisionNo) || "";
        return String(pDivisionNo) === String(divisionNo);
      })
      .map(p => p.operatorName || p.name || p.fullName)
      .filter(Boolean);
  }, [deliveryOperators]);

  useEffect(() => {
    fetchDocuments(false);
    fetchDivisions();
  }, [fetchDocuments, fetchDivisions]);

  // useEffect(() => {
  //   const id = setInterval(() => fetchDocuments(true), AUTO_REFRESH);
  //   return () => clearInterval(id);
  // }, [fetchDocuments]);

  // ── Access-scoped documents ──
  // Admin / System Administrator (or any role with allDivisions: true) see
  // every document. Every other login only ever sees documents belonging to
  // the division(s) assigned to their account — this feeds the table,
  // stats, dropdowns, and request-ID numbering below, so nothing in the UI
  // ever shows another division's data to a non-admin login.
  const accessScopedDocuments = useMemo(() => {
    if (hasAllDiv) return documents;
    return documents.filter((doc) => canSeeDivision(currentUser, doc.divisionNo));
  }, [documents, hasAllDiv, currentUser]);

  const getDocById = useCallback((id) => accessScopedDocuments.find(d => d.id === id), [accessScopedDocuments]);

  const handleDeliveredClick = (id) => { setActiveId(id); setActivePopup("delivered"); };
  const handleHoldClick      = (id) => { setActiveId(id); setActivePopup("hold"); };
  const handleCancelClick    = (id) => { setActiveId(id); setActivePopup("cancel"); };
  const handleHandoverClick  = (id) => { setActiveId(id); setActivePopup("handover"); };
  const handleChangeVehicle  = (doc, mode = "request") => { setVehicleDoc(doc); setVehicleMode(mode); setActivePopup("vehicle"); };
  const handleEditClick      = (doc) => { setActiveId(doc.id); setActivePopup("edit"); };
  const closePopup = () => { setActivePopup(null); setActiveId(null); setVehicleDoc(null); setVehicleMode("request"); };

  // keep the view drawer's data in sync after a refresh
  useEffect(() => {
    if (!viewDoc) return;
    const fresh = documents.find(d => d.id === viewDoc.id);
    if (fresh) setViewDoc(fresh);
  }, [documents]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleHoldConfirm = async (holdReason, heldBy) => {
    closePopup();
    try {
      await fetch(`${API_BASE}/${activeId}/hold`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdReason, heldBy }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Hold failed: " + err.message);
    }
  };

  const handleDeliveryDoneConfirm = async (deliveredBy, vehicleNo) => {
    closePopup();
    try {
      await fetch(`${API_BASE}/${activeId}/end`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveredBy, vehicleNo }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Delivery Done failed: " + err.message);
    }
  };

  const handleCancelConfirm = async (cancelReason, cancelledBy) => {
    closePopup();
    try {
      await fetch(`${API_BASE}/${activeId}/cancel`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelReason, cancelledBy }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Cancel failed: " + err.message);
    }
  };

  // Handover — locks Delivered/Hold/Cancel + Delete for this row once saved.
  // NOTE: this calls PUT {API_BASE}/{id}/handover with { handoverBy }.
  // Add this endpoint on the backend (mirroring /hold, /cancel, /end) so it
  // persists doc.handoverBy / doc.handoverTime.
  const handleHandoverConfirm = async (handoverBy) => {
    closePopup();
    try {
      await fetch(`${API_BASE}/${activeId}/handover`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoverBy }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Handover failed: " + err.message);
    }
  };

  // Reactivate — reverses a Handover. Clears doc.handoverBy/handoverTime and
  // unlocks Delivered / Hold / Cancel / Delete for this row again.
  // NOTE: this calls PUT {API_BASE}/{id}/reactivate with no body.
  // BACKEND CONTRACT: this endpoint must clear handoverBy + handoverTime,
  // AND reset deliveryStatus away from "On Hold"/"Cancelled" (e.g. back to
  // "Pending") — otherwise the row will re-lock itself on the next refresh,
  // since Hold/Cancelled status locks the row on its own.
  // We also apply an OPTIMISTIC local update immediately on click so the
  // buttons unlock instantly, without waiting for the next poll.
  const handleReactivateClick = async (id) => {
    if (!window.confirm("Reactivate this document? This will unlock Delivered / Hold / Cancel for this row again.")) return;

    // Optimistic unlock — flip this row to Pending + clear handover locally.
    setDocuments(prev => prev.map(d =>
      d.id === id ? { ...d, deliveryStatus: "PENDING", handoverBy: null, handoverTime: null } : d
    ));

    try {
      const res = await fetch(`${API_BASE}/${id}/reactivate`, { method: "PUT" });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      fetchDocuments(true);
    } catch (err) {
      alert("Reactivate failed: " + err.message);
      fetchDocuments(true); // roll back to server truth if the call failed
    }
  };

  const handleEditConfirm = async ({ heldBy, cancelledBy, deliveredBy }) => {
    const id = activeId; closePopup();
    try {
      const res = await fetch(`${API_BASE}/${id}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heldBy, cancelledBy, deliveredBy }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      fetchDocuments(true);
    } catch (err) {
      alert("Edit failed: " + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this document from the Delivery Portal? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      fetchDocuments(true);
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  // Updates either the *request* vehicle no (doc.vehicleNo) or the
  // *delivery* vehicle no (doc.deliveryVehicleNo, entered at "Delivery Done")
  // depending on which was chosen from the View drawer.
  const handleChangeVehicleConfirm = async (vehicleNo) => {
    const id = vehicleDoc?.id;
    const isDelivery = vehicleMode === "delivery";
    closePopup();
    if (!id) return;
    const endpoint = isDelivery ? `${API_BASE}/${id}/delivery-vehicle` : `${API_BASE}/${id}/vehicle`;
    const payload  = isDelivery ? { deliveryVehicleNo: vehicleNo } : { vehicleNo };
    try {
      await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Change Vehicle failed: " + err.message);
    }
  };

  // ── Filters ──
  // Job Type / Status / Division dropdown option lists are all built off
  // accessScopedDocuments, so a non-admin login never even sees another
  // division's divisionNo as an option.
  const jobTypes = ["ALL", ...new Set(accessScopedDocuments.map(d => d.jobType).filter(Boolean))];
  const statuses = ["ALL", ...new Set(accessScopedDocuments.map(d => d.deliveryStatus).filter(Boolean))];

  // Division dropdown — Admin/System Admin get every division that appears
  // in the data; every other login only gets their own assigned division(s).
  const divisionOptions = useMemo(() => {
    const list = hasAllDiv
      ? [...new Set(accessScopedDocuments.map(d => d.divisionNo).filter(Boolean))]
      : userDivisions;
    return ["ALL", ...list];
  }, [hasAllDiv, userDivisions, accessScopedDocuments]);

  const visible = accessScopedDocuments.filter(doc => {
    const q = search.toLowerCase();
    const matchSearch = !q || [
      String(doc.id), doc.customerName, doc.jobwbs,
      doc.reservationNo, doc.enteredBy, doc.jobType, doc.printDocumentNo,
      doc.requestedBy, doc.vehicleNo, doc.deliveryVehicleNo,
    ].some(v => (v || "").toLowerCase().includes(q));

    const matchType     = filterType     === "ALL" || doc.jobType === filterType;
    const matchStatus   = filterStatus   === "ALL" || doc.deliveryStatus === filterStatus;
    const matchDivision = filterDivision === "ALL" || doc.divisionNo === filterDivision;
    const matchStat     = statFilter     === "ALL" || statusClass(doc.deliveryStatus) === statFilter;
    const matchDate     = matchesDateFilter(doc, dateFilterMode, fromDate, toDate);

    return matchSearch && matchType && matchStatus && matchDivision && matchStat && matchDate;
  });

  // Stats — scoped by division access + the date filter too, so counts on
  // screen always match what's actually shown in the table below (e.g.
  // "Today" only counts today's documents, not every document ever
  // entered, and a non-admin login only ever counts their own division).
  // Mirrors Print Portal / Pick Portal / Check Portal.
  const dateScoped = useMemo(
    () => accessScopedDocuments.filter(doc => matchesDateFilter(doc, dateFilterMode, fromDate, toDate)),
    [accessScopedDocuments, dateFilterMode, fromDate, toDate]
  );

  const total     = dateScoped.length;
  const pending   = dateScoped.filter(d => statusClass(d.deliveryStatus) === "pending").length;
  const onHold    = dateScoped.filter(d => statusClass(d.deliveryStatus) === "onhold").length;
  const completed = dateScoped.filter(d => statusClass(d.deliveryStatus) === "completed").length;
  const cancelled = dateScoped.filter(d => statusClass(d.deliveryStatus) === "cancelled").length;

  const overdueDocs  = dateScoped.filter(d => {
    const p = daysPending(d);
    return p !== null && p > OVERDUE_DAYS && statusClass(d.deliveryStatus) !== "completed";
  });
  const overdueCount = overdueDocs.length;

  const requestIdMap = useMemo(() => computeRequestIds(accessScopedDocuments), [accessScopedDocuments]);

  const activeDoc = getDocById(activeId);
  const activeOperatorNames = useMemo(
    () => getOperatorNamesForDivision(activeDoc?.divisionNo),
    [activeDoc, getOperatorNamesForDivision]
  );

  // Don't flash the portal UI while the auth-guard redirect is in flight.
  if (!currentUser || !canAccessRoute(currentUser, "/delivery")) {
    return null;
  }

  return (
    <div className="ip-page">

      {activePopup === "hold" && (
        <HoldPopup operatorNames={activeOperatorNames} onConfirm={handleHoldConfirm} onCancel={closePopup} />
      )}
      {activePopup === "delivered" && (
        <DeliveryDonePopup operatorNames={activeOperatorNames} onConfirm={handleDeliveryDoneConfirm} onCancel={closePopup} />
      )}
      {activePopup === "cancel" && (
        <CancelPopup operatorNames={activeOperatorNames} onConfirm={handleCancelConfirm} onCancel={closePopup} />
      )}
      {activePopup === "handover" && (
        <HandoverPopup operatorNames={activeOperatorNames} onConfirm={handleHandoverConfirm} onCancel={closePopup} />
      )}
      {activePopup === "edit" && (
        <EditPopup doc={activeDoc} operatorNames={activeOperatorNames} onConfirm={handleEditConfirm} onCancel={closePopup} />
      )}
      {activePopup === "vehicle" && vehicleDoc && (
        <ChangeVehiclePopup doc={vehicleDoc} mode={vehicleMode} onConfirm={handleChangeVehicleConfirm} onCancel={closePopup} />
      )}
      {viewDoc && (
        <ViewDrawer
          doc={viewDoc}
          divisionLabel={divisionLabelFor(viewDoc)}
          onClose={() => setViewDoc(null)}
          onChangeVehicle={handleChangeVehicle}
        />
      )}

      {/* ── Header ── */}
      <div className="ip-header">
        <div className="ip-header-left">
          <h1>LOGITRACK-WAREHOUSE TIME EFFICENCY TRACKER SYSTEM</h1>
          <h1>  Delivery Portal</h1>
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

      {/* ── Overdue notification ── */}
      {overdueCount > 0 && (
        <div className="ip-overdue-banner">
          <span className="ip-overdue-banner-icon">⚠</span>
          <span>
            <strong>{overdueCount}</strong> {overdueCount === 1 ? "document has" : "documents have"} been pending (from request date) for more than {OVERDUE_DAYS} {OVERDUE_DAYS === 1 ? "day" : "days"}
          </span>
          <button
            className="ip-overdue-banner-action"
            onClick={() => { setFilterStatus("ALL"); setSearch(""); }}
          >
            View all
          </button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="ip-toolbar">
        <div className="ip-search-wrap">
          <span className="ip-search-icon">🔍</span>
          <input
            className="ip-search"
            type="text"
            placeholder="Search by ID, Customer, WBS, Reservation, Print Doc No, Requested By, Vehicle No..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="ip-filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          {jobTypes.map(t => <option key={t} value={t}>{t === "ALL" ? "All Job Types" : t}</option>)}
        </select>
        <select className="ip-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {statuses.map(s => <option key={s} value={s}>{s === "ALL" ? "All Status" : s}</option>)}
        </select>
        {/* Division filter — Admin/System Admin see every division that has
            data; every other login only ever sees their own assigned
            division(s) here, same as the rest of the portal. */}
        <select className="ip-filter-select" value={filterDivision} onChange={e => setFilterDivision(e.target.value)}>
          {divisionOptions.map(d => (
            <option key={d} value={d}>
              {d === "ALL" ? "All Divisions" : `${d} — ${divisionNoToName[d] || ""}`}
            </option>
          ))}
        </select>
      </div>

      {/* ── Date filter — Today (Sri Lanka time, default) / All / Custom
          range. Same toolbar pattern as Print Portal / Pick Portal / Check
          Portal. ── */}
      <div className="ip-toolbar" style={{ marginTop: -6 }}>
        {DATE_FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={`ip-filter-select ip-stat-chip-clickable ${dateFilterMode === opt.value ? "active" : ""}`}
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
              className="ip-filter-select"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
            />
            <span style={{ color: "#6c8bb3" }}>—</span>
            <input
              type="date"
              className="ip-filter-select"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
            />
            {(fromDate || toDate) && (
              <button
                type="button"
                className="ip-btn ip-btn-outline"
                style={{ flex: "unset", padding: "6px 14px" }}
                onClick={() => { setFromDate(""); setToDate(""); }}
              >
                ✕ Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="ip-stats">
        <button
          className="ip-stat-chip blue"
          onClick={() => setStatFilter("ALL")}
          style={{
            cursor: "pointer",
            border: statFilter === "ALL" ? "2px solid #3b82f6" : "1px solid transparent",
            fontWeight: statFilter === "ALL" ? 700 : 400,
          }}
        >
          Total <strong>{total}</strong>
        </button>
        <button
          className="ip-stat-chip"
          onClick={() => setStatFilter(prev => prev === "pending" ? "ALL" : "pending")}
          style={{
            cursor: "pointer",
            border: statFilter === "pending" ? `2px solid ${STATUS_COLORS.pending.bg}` : "1px solid transparent",
            backgroundColor: statFilter === "pending" ? STATUS_COLORS.pending.bg : undefined,
            color: statFilter === "pending" ? STATUS_COLORS.pending.text : "#f59e0b",
          }}
        >
          <strong style={{ color: statFilter === "pending" ? STATUS_COLORS.pending.text : "#f59e0b" }}>{pending}</strong> Pending
        </button>
        <button
          className="ip-stat-chip"
          onClick={() => setStatFilter(prev => prev === "onhold" ? "ALL" : "onhold")}
          style={{
            cursor: "pointer",
            border: statFilter === "onhold" ? `2px solid ${STATUS_COLORS.onhold.bg}` : "1px solid transparent",
            backgroundColor: statFilter === "onhold" ? STATUS_COLORS.onhold.bg : undefined,
            color: statFilter === "onhold" ? STATUS_COLORS.onhold.text : "#fb923c",
          }}
        >
          <strong style={{ color: statFilter === "onhold" ? STATUS_COLORS.onhold.text : "#fb923c" }}>{onHold}</strong> On Hold
        </button>
        <button
          className="ip-stat-chip green"
          onClick={() => setStatFilter(prev => prev === "completed" ? "ALL" : "completed")}
          style={{
            cursor: "pointer",
            border: statFilter === "completed" ? `2px solid ${STATUS_COLORS.completed.bg}` : "1px solid transparent",
            fontWeight: statFilter === "completed" ? 700 : 400,
          }}
        >
          Delivered <strong>{completed}</strong>
        </button>
        <button
          className="ip-stat-chip"
          onClick={() => setStatFilter(prev => prev === "cancelled" ? "ALL" : "cancelled")}
          style={{
            cursor: "pointer",
            border: statFilter === "cancelled" ? `2px solid ${STATUS_COLORS.cancelled.bg}` : "1px solid transparent",
            backgroundColor: statFilter === "cancelled" ? STATUS_COLORS.cancelled.bg : undefined,
            color: statFilter === "cancelled" ? STATUS_COLORS.cancelled.text : "#ef4444",
          }}
        >
          <strong style={{ color: statFilter === "cancelled" ? STATUS_COLORS.cancelled.text : "#ef4444" }}>{cancelled}</strong> Cancelled
        </button>
        <div className="ip-stat-chip">Showing <strong style={{color:"#a78bfa"}}>{visible.length}</strong> of {total}</div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="ip-error-inline">
          ⚠ {error} —{" "}
          <button onClick={() => fetchDocuments(false)}>retry</button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="ip-table-wrap">
        <table className="ip-table">
          <thead>
            <tr>
              <th>Req ID</th>
              <th>Division</th>
              <th>WBS</th>
              <th>Doc No</th>
              <th>Customer</th>
              <th>Req Date/Time</th>
              <th>Requested By / Vehicle</th>
              <th>Delivery Vehicle No</th>
              <th>Pending</th>
              <th>Status</th>
              <th>View</th>
              {canManageDocs && <th>Manage</th>}
              <th>Actions</th>
              {canHandoverAccess && <th className="ip-th-handover">Handover</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} columnCount={visibleColumnCount} />)
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={visibleColumnCount}>
                  <div className="ip-empty">
                    <div className="ip-empty-icon">📭</div>
                    <p>
                      {accessScopedDocuments.length === 0
                        ? "No Check Done documents yet. Complete checks first."
                        : `No documents found${search ? ` for "${search}"` : ""}.`}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              visible.map(doc => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  requestId={requestIdMap[doc.id]}
                  divisionLabel={divisionLabelFor(doc)}
                  canManage={canManageDocs}
                  canHandover={canHandoverAccess}
                  onView={setViewDoc}
                  onDelivered={handleDeliveredClick}
                  onHold={handleHoldClick}
                  onCancelled={handleCancelClick}
                  onHandover={handleHandoverClick}
                  onReactivate={handleReactivateClick}
                  onEdit={handleEditClick}
                  onDelete={handleDelete}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
