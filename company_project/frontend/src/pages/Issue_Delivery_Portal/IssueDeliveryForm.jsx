import { useState, useEffect, useCallback } from "react";
import "./IssueDelivery.css";

const API_BASE = "http://localhost:8080/api/delivery-portal";
// Master Setup API — same base the Admin Dashboard's "Master Setup → Delivery"
// panel saves to. We read from here so Held By / Cancelled By / Delivered By
// always match whatever names are entered in Admin Dashboard, live from the DB.
const SETUP_API = "http://localhost:8080/api/admin-setup";
const AUTO_REFRESH = 10000;
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d) { return d || "—"; }
function formatTime(t) { return t ? String(t).substring(0, 5) : "—"; }

function formatDateTime(dt) {
  if (!dt) return "—";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Days are now always measured against the *request* date/time — this is
// when the customer originally raised the request, not when it was printed.
// The per-row "days pending" number always shows; only the ⚠ overdue
// highlight + banner kick in once it passes this threshold.
const OVERDUE_DAYS = 30;

function getRequestDateTime(doc) {
  if (!doc.requestDate) return null;
  const rawTime = (doc.requestTime || "00:00:00").trim();
  // Zero-pad H:MM / H:MM:SS style times (e.g. "9:39" -> "09:39:00") so the
  // combined string is valid ISO — a bare "9:39" makes `new Date(...)`
  // silently return an Invalid Date in some browsers, which then shows as
  // "—" in the Pending column even though the request date is perfectly fine.
  const parts = rawTime.split(":");
  const hh = (parts[0] || "0").padStart(2, "0");
  const mm = (parts[1] || "0").padStart(2, "0");
  const ss = (parts[2] || "0").padStart(2, "0");
  return `${doc.requestDate}T${hh}:${mm}:${ss}`;
}

function daysPending(doc) {
  const raw = getRequestDateTime(doc);
  let requested = raw ? new Date(raw) : null;

  // Fallback: if the request date/time couldn't be parsed (bad format from
  // backend, etc.), use when the document was entered instead of showing "—".
  if (!requested || isNaN(requested.getTime())) {
    if (doc.createdDatetime) requested = new Date(doc.createdDatetime);
  }
  if (!requested || isNaN(requested.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - requested.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
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

function yn(v) {
  if (v === true || v === "YES" || v === "Yes" || v === "yes") return "Yes";
  if (v === false || v === "NO" || v === "No" || v === "no") return "No";
  return v || "—";
}

// ── Delivery operator names — live from Master Setup (DB) ──────────────────
// Replaces the old hardcoded PEOPLE_OPTIONS list. Reads the same
// "/delivery-operators" table that Admin Dashboard → Master Setup → Delivery
// writes to, so adding / editing / deleting a delivery operator there shows
// up here automatically (polled).

function useDeliveryOperatorNames() {
  const [names, setNames] = useState([]);

  const load = useCallback(() => {
    fetch(`${SETUP_API}/delivery-operators`)
      .then(res => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setNames(
          (Array.isArray(data) ? data : [])
            .map(p => p.operatorName)
            .filter(Boolean)
        );
      })
      .catch(() => { /* keep last known list on transient errors */ });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, OPERATOR_REFRESH);
    return () => clearInterval(id);
  }, [load]);

  return names;
}

// ── Generic Person Picker ──────────────────────────────────────────────────
// Now driven purely by the `options` prop (Master Setup delivery operator
// names). "Other" free-text entry has been removed — only names that exist
// in the Delivery Operators master table can be selected, so whatever gets
// saved to the DB (heldBy / cancelledBy / deliveredBy) always matches
// Master Setup.

function PersonPicker({ value, onChange, options }) {
  if (!options || options.length === 0) {
    return (
      <div className="ip-popup-options">
        <div style={{ color: "#7c8db0", fontSize: "0.8rem", padding: "8px 2px" }}>
          No delivery operators set up yet. Add names in Admin Dashboard → Master Setup → Delivery.
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
          <span> Delivery Done</span>
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

// ── Popup: Change (Request) Vehicle No ──────────────────────────────────────
// Separate from "Delivery Vehicle No" — this edits the vehicle number that
// was originally entered against the request itself.

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

function ViewDrawer({ doc, onClose, onChangeVehicle }) {
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

function DocumentRow({ doc, onView, onDelivered, onHold, onCancelled, onChangeVehicle }) {
  const sc      = statusClass(doc.deliveryStatus);
  const isFinal = sc === "completed"; // only locked once delivered — hold & cancel stay editable
  const pending = daysPending(doc);
  const isOverdue = pending !== null && pending > OVERDUE_DAYS && sc !== "completed";

  return (
    <tr className={`ip-row status-${sc} ${isOverdue ? "overdue" : ""}`}>
      <td className="ip-td-id">{doc.id}</td>
      <td>{doc.jobwbs || "—"}</td>
      <td className="ip-td-docno">{doc.printDocumentNo ? doc.printDocumentNo : `Doc #${doc.id}`}</td>
      <td>{doc.customerName || "—"}</td>
      <td className="ip-td-datetime">
        {formatDate(doc.requestDate)} <span className="ip-td-time">{formatTime(doc.requestTime)}</span>
      </td>
      <td className="ip-td-requested">
        <div>{doc.requestedBy || "—"}</div>
        <div className="ip-td-vehicle">
          🚐 {doc.vehicleNo || "—"}
          <button className="ip-inline-edit-btn" title="Change Vehicle No" onClick={() => onChangeVehicle(doc, "request")}>✏️</button>
        </div>
      </td>
      <td className="ip-td-requested">
        <div className="ip-td-vehicle">
          🚐 {doc.deliveryVehicleNo || "—"}
          <button className="ip-inline-edit-btn" title="Change Delivery Vehicle No" onClick={() => onChangeVehicle(doc, "delivery")}>✏️</button>
        </div>
      </td>
      <td>
        {pending === null ? "—" : (
          <span className={`ip-pending-badge ${isOverdue ? "overdue" : ""}`}>
            {isOverdue && "⚠ "}{pending} {pending === 1 ? "day" : "days"}
          </span>
        )}
      </td>
      <td><span className={`ip-badge ${sc}`}>{statusLabel(doc.deliveryStatus)}</span></td>
      <td>
        <button className="ip-btn-view" onClick={() => onView(doc)}>👁 View</button>
      </td>
      <td>
        <div className="ip-row-actions">
          <button
            className={`ip-mini-btn ip-mini-end ${sc === "completed" ? "active" : ""}`}
            disabled={isFinal}
            title="Delivered"
            onClick={() => onDelivered(doc.id)}
          >
            ✅
          </button>
          <button
            className={`ip-mini-btn ip-mini-hold ${sc === "onhold" ? "active" : ""}`}
            disabled={isFinal}
            title="Hold"
            onClick={() => onHold(doc.id)}
          >
            ⏸
          </button>
          <button
            className={`ip-mini-btn ip-mini-cancel ${sc === "cancelled" ? "active" : ""}`}
            disabled={isFinal}
            title="Cancelled"
            onClick={() => onCancelled(doc.id)}
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Skeleton Row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="ip-row">
      {Array.from({ length: 11 }).map((_, i) => (
        <td key={i}>
          <div className="ip-skeleton" style={{ width: "80%", height: 12 }} />
        </td>
      ))}
    </tr>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function IssueDeliveryForm() {
  const [documents,    setDocuments]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [search,       setSearch]       = useState("");
  const [filterType,   setFilterType]   = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const [refreshing,   setRefreshing]   = useState(false);

  // Delivery operator names — live from Admin Dashboard → Master Setup → Delivery (DB).
  const deliveryOperatorNames = useDeliveryOperatorNames();

  const [activePopup,  setActivePopup]  = useState(null); // "hold" | "delivered" | "cancel" | "vehicle" | null
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

  useEffect(() => { fetchDocuments(false); }, [fetchDocuments]);

  useEffect(() => {
    const id = setInterval(() => fetchDocuments(true), AUTO_REFRESH);
    return () => clearInterval(id);
  }, [fetchDocuments]);

  const handleDeliveredClick = (id) => { setActiveId(id); setActivePopup("delivered"); };
  const handleHoldClick      = (id) => { setActiveId(id); setActivePopup("hold"); };
  const handleCancelClick    = (id) => { setActiveId(id); setActivePopup("cancel"); };
  const handleChangeVehicle  = (doc, mode = "request") => { setVehicleDoc(doc); setVehicleMode(mode); setActivePopup("vehicle"); };
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

  // Updates either the *request* vehicle no (doc.vehicleNo) or the
  // *delivery* vehicle no (doc.deliveryVehicleNo, entered at "Delivery Done")
  // depending on which pencil icon was clicked. Adjust the URLs below to
  // match your backend routes if they differ.
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
  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];
  const statuses = ["ALL", ...new Set(documents.map(d => d.deliveryStatus).filter(Boolean))];

  const visible = documents.filter(doc => {
    const q = search.toLowerCase();
    const matchSearch = !q || [
      String(doc.id), doc.customerName, doc.jobwbs,
      doc.reservationNo, doc.enteredBy, doc.jobType, doc.printDocumentNo,
      doc.requestedBy, doc.vehicleNo, doc.deliveryVehicleNo,
    ].some(v => (v || "").toLowerCase().includes(q));

    const matchType   = filterType   === "ALL" || doc.jobType === filterType;
    const matchStatus = filterStatus === "ALL" || doc.deliveryStatus === filterStatus;

    return matchSearch && matchType && matchStatus;
  });

  // Stats
  const total     = documents.length;
  const pending   = documents.filter(d => statusClass(d.deliveryStatus) === "pending").length;
  const onHold    = documents.filter(d => statusClass(d.deliveryStatus) === "onhold").length;
  const completed = documents.filter(d => statusClass(d.deliveryStatus) === "completed").length;
  const cancelled = documents.filter(d => statusClass(d.deliveryStatus) === "cancelled").length;

  const overdueDocs  = documents.filter(d => {
    const p = daysPending(d);
    return p !== null && p > OVERDUE_DAYS && statusClass(d.deliveryStatus) !== "completed";
  });
  const overdueCount = overdueDocs.length;

  return (
    <div className="ip-page">

      {activePopup === "hold" && (
        <HoldPopup operatorNames={deliveryOperatorNames} onConfirm={handleHoldConfirm} onCancel={closePopup} />
      )}
      {activePopup === "delivered" && (
        <DeliveryDonePopup operatorNames={deliveryOperatorNames} onConfirm={handleDeliveryDoneConfirm} onCancel={closePopup} />
      )}
      {activePopup === "cancel" && (
        <CancelPopup operatorNames={deliveryOperatorNames} onConfirm={handleCancelConfirm} onCancel={closePopup} />
      )}
      {activePopup === "vehicle" && vehicleDoc && (
        <ChangeVehiclePopup doc={vehicleDoc} mode={vehicleMode} onConfirm={handleChangeVehicleConfirm} onCancel={closePopup} />
      )}
      {viewDoc && (
        <ViewDrawer doc={viewDoc} onClose={() => setViewDoc(null)} onChangeVehicle={handleChangeVehicle} />
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
        <button
          className="ip-btn ip-btn-outline"
          style={{ flex: "unset", padding: "8px 18px" }}
          onClick={() => fetchDocuments(false)}
        >
          ↻ Refresh
        </button>
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
      </div>

      {/* ── Stats ── */}
      <div className="ip-stats">
        <div className="ip-stat-chip blue">Total <strong>{total}</strong></div>
        <div className="ip-stat-chip"><strong style={{color:"#f59e0b"}}>{pending}</strong> Pending</div>
        <div className="ip-stat-chip"><strong style={{color:"#fb923c"}}>{onHold}</strong> On Hold</div>
        <div className="ip-stat-chip green">Delivered <strong>{completed}</strong></div>
        <div className="ip-stat-chip"><strong style={{color:"#ef4444"}}>{cancelled}</strong> Cancelled</div>
        <div className="ip-stat-chip">Showing <strong style={{color:"#a78bfa"}}>{visible.length}</strong> of {total}</div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          background:"rgba(239,68,68,0.12)", border:"1px solid #ef4444",
          borderRadius:8, padding:"12px 16px", color:"#fca5a5",
          marginBottom:18, fontSize:"0.85rem",
        }}>
          ⚠ {error} —{" "}
          <button onClick={() => fetchDocuments(false)}
            style={{background:"none",border:"none",color:"#60a5fa",cursor:"pointer",textDecoration:"underline"}}>
            retry
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="ip-table-wrap">
        <table className="ip-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>WBS</th>
              <th>Doc No</th>
              <th>Customer</th>
              <th>Req Date/Time</th>
              <th>Requested By / Vehicle</th>
              <th>Delivery Vehicle No</th>
              <th>Pending</th>
              <th>Status</th>
              <th>View</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={11}>
                  <div className="ip-empty">
                    <div className="ip-empty-icon">📭</div>
                    <p>
                      {documents.length === 0
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
                  onView={setViewDoc}
                  onDelivered={handleDeliveredClick}
                  onHold={handleHoldClick}
                  onCancelled={handleCancelClick}
                  onChangeVehicle={handleChangeVehicle}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
