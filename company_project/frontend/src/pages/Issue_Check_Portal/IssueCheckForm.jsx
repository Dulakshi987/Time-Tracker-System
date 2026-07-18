import { useState, useEffect, useCallback, useMemo } from "react";
// import DateRangeFilter from "./DateRangeFilter";
import "./IssueCheck.css";

const API_BASE = "http://localhost:8080/api/check-portal";
const AUTO_REFRESH = 10000;

const PEOPLE_OPTIONS = ["Kavishaka", "Anushi", "Chaminda"];

const HOLD_REASONS = [
  "Printer not available",
 
];

// Reasons a Picking Error can be logged under.
// Only "Material Shortage" and "Material Excess" represent an actual
// picking error that needs SKU/Qty capture + triggers the Emergency Pick
// workflow (red banner, hasWrongMaterial flag, etc). "Collected Different
// Material" is logged for record-keeping but does NOT create a picking
// error / does not require SKU+Qty or trigger the emergency pick flow.
const PICKING_ERROR_REASONS = [
  { key: "SHORTAGE", label: "Material Shortage", createsError: true },
  { key: "EXCESS", label: "Material Excess", createsError: true },
  { key: "DIFFERENT", label: "Collected Different Material", createsError: false },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d) { return d || "—"; }
function formatTime(t) { return t ? String(t).substring(0, 5) : "—"; }

function formatDateTime(dt) {
  if (!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

// Groups documents by their request date and numbers each group starting
// from 1, then combines that with the date to build a unique Request ID
// like 20260816/0001. Same scheme as Pick Portal / Print Portal, so IDs
// read consistently across all three portals.
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

function statusClass(s) {
  const v = (s || "").toLowerCase();
  if (v.includes("hold"))     return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("complete") || v.includes("done")) return "completed";
  return "pending";
}

function statusLabel(s) {
  const c = statusClass(s);
  return { pending: "Pending", inprogress: "In Progress", onhold: "On Hold", completed: "Check Done" }[c];
}

// ── Generic Person Picker (with Other text input) ──────────────────────────

function PersonPicker({ value, onChange }) {
  const [showOther, setShowOther] = useState(value && !PEOPLE_OPTIONS.includes(value));
  const [otherVal, setOtherVal]   = useState(showOther ? value : "");

  return (
    <div className="ip-popup-options">
      {PEOPLE_OPTIONS.map(name => (
        <button
          key={name}
          className={`ip-popup-option ${value === name && !showOther ? "selected" : ""}`}
          onClick={() => { setShowOther(false); onChange(name); }}
        >
          👤 {name}
        </button>
      ))}
      <button
        className={`ip-popup-option ${showOther ? "selected" : ""}`}
        onClick={() => { setShowOther(true); onChange(otherVal); }}
      >
        ✏️ Other
      </button>
      {showOther && (
        <input
          className="ip-popup-input"
          type="text"
          placeholder="Type name..."
          value={otherVal}
          onChange={e => { setOtherVal(e.target.value); onChange(e.target.value); }}
          autoFocus
        />
      )}
    </div>
  );
}

// ── Popup: Hold Reason + Held By ────────────────────────────────────────────

function HoldPopup({ onConfirm, onCancel }) {
  const [reason, setReason]   = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [heldBy, setHeldBy]   = useState("");
  const [pickingErrorKey, setPickingErrorKey] = useState(null); // "SHORTAGE" | "EXCESS" | "DIFFERENT" | "NONE" | null
  const [sku, setSku]         = useState("");
  const [qty, setQty]         = useState("");

  const isOtherReason = reason === "Other";
  const finalReason   = isOtherReason ? otherReason.trim() : reason;

  const selectedErrorReason = PICKING_ERROR_REASONS.find(r => r.key === pickingErrorKey) || null;
  // Only "Material Shortage" and "Material Excess" actually create a picking
  // error (and therefore require SKU/Qty). "Collected Different Material" is
  // recorded but does not create a picking error.
  const needsDetails = !!selectedErrorReason && selectedErrorReason.createsError;

  const canConfirm =
    !!finalReason &&
    !!heldBy &&
    pickingErrorKey !== null &&
    (!needsDetails || (sku.trim().length > 0 && qty.trim().length > 0));

  const handleConfirm = () => {
    const hasWrongMaterial = needsDetails ? "YES" : "NO";
    onConfirm(
      finalReason,
      heldBy,
      hasWrongMaterial,
      needsDetails ? sku.trim() : "",
      needsDetails ? qty.trim() : "",
      pickingErrorKey === "NONE" ? "" : (selectedErrorReason ? selectedErrorReason.label : "")
    );
  };

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>⏸ Hold Check</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select a reason, who is holding this, and whether there's a picking error</p>

        <span className="ip-popup-label">Picking Error?</span>
        <div className="ip-popup-options" style={{ marginBottom: needsDetails ? 16 : 16 }}>
          {PICKING_ERROR_REASONS.map(r => (
            <button
              key={r.key}
              className={`ip-popup-option ${pickingErrorKey === r.key ? "selected" : ""}`}
              onClick={() => { setPickingErrorKey(r.key); if (!r.createsError) { setSku(""); setQty(""); } }}
            >
              {r.createsError ? "⚠️ " : "ℹ️ "}{r.label}
            </button>
          ))}
          <button
            className={`ip-popup-option ${pickingErrorKey === "NONE" ? "selected" : ""}`}
            onClick={() => { setPickingErrorKey("NONE"); setSku(""); setQty(""); }}
          >
            ✅ No Picking Error
          </button>
        </div>

        {needsDetails && (
          <>
            <div className="ip-popup-field">
              <span className="ip-popup-label">SKU / Description</span>
              <input
                className="ip-popup-text-input"
                type="text"
                placeholder="Enter SKU or description..."
                value={sku}
                onChange={e => setSku(e.target.value)}
              />
            </div>
            <div className="ip-popup-field" style={{ marginBottom: 16 }}>
              <span className="ip-popup-label">Quantity</span>
              <input
                className="ip-popup-text-input"
                type="text"
                placeholder="Enter quantity..."
                value={qty}
                onChange={e => setQty(e.target.value)}
              />
            </div>
          </>
        )}

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
        <PersonPicker value={heldBy} onChange={setHeldBy} />

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-hold-confirm"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            ⏸ Confirm Hold
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: Check Done (Yes/No wrong material) ────────────────────────────────

function CheckDonePopup({ onConfirm, onCancel }) {
  const [checkedBy, setCheckedBy] = useState("");
  const canConfirm = !!checkedBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>✅ Check Done</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select who completed this check</p>

        <PersonPicker value={checkedBy} onChange={setCheckedBy} />

        <div className="ip-popup-foot" style={{ marginTop: 18 }}>
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            disabled={!canConfirm}
            onClick={() => onConfirm(checkedBy)}
          >
            ✅ Check Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: View Full Details (Print + Pick) ──────────────────────────────────

function ViewDetailsPopup({ doc, onClose }) {
  if (!doc) return null;

  const row = (label, value) => (
    <div className="ip-hold-row" key={label}>
      <span>{label}</span>
      <span>{value ?? "—"}</span>
    </div>
  );

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>📋 Full Details</span>
          <button className="ip-popup-close" onClick={onClose}>✕</button>
        </div>
        <p className="ip-popup-sub">Complete history for this document</p>

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Print Portal
        </div>
        <div className="ip-hold-box" style={{ marginBottom: 14 }}>
          {row("Handed Over By", doc.printHandedOverBy && `👤 ${doc.printHandedOverBy}`)}
          {row("Document Number", doc.printDocumentNo)}
          {row("Vehicle Number", doc.vehicleNo)}
          {row("Print Hold Reason", doc.printHoldReason)}
          {row("Print Held By", doc.printHeldBy && `👤 ${doc.printHeldBy}`)}
          {row("Print Held At", formatDateTime(doc.printHoldTime))}
          {row("Printed By", doc.printedBy && `👤 ${doc.printedBy}`)}
          {row("Print Duration", `⏱ ${formatDuration(doc.printDurationSeconds)}`)}
        </div>

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Pick Portal
        </div>
        <div className="ip-hold-box" style={{ marginBottom: 14 }}>
          {row("Pick Hold Reason", doc.pickHoldReason)}
          {row("Pick Held By", doc.pickHeldBy && `👤 ${doc.pickHeldBy}`)}
          {row("Pick Held At", formatDateTime(doc.pickHoldTime))}
          {row("Picked By", doc.pickedBy && `👤 ${doc.pickedBy}`)}
          {row("Pick Duration", `⏱ ${formatDuration(doc.pickDurationSeconds ?? doc.durationSeconds)}`)}
        </div>

        {doc.pickingErrorReason && (doc.hasWrongMaterial || "").toUpperCase() !== "YES" && (
          <>
            <div style={{ marginBottom: 6, fontSize: "0.78rem", fontWeight: 700, color: "#7c8db0" }}>
              ℹ️ Picking Note
            </div>
            <div className="ip-hold-box" style={{ marginBottom: 14 }}>
              {row("Note", doc.pickingErrorReason)}
            </div>
          </>
        )}

        {(doc.hasWrongMaterial || "").toUpperCase() === "YES" && (
          <>
            <div
              style={{
                marginBottom: 6, fontSize: "0.78rem", fontWeight: 700,
                color: doc.emergencyPickResolved ? "#34d399" : "#ef4444",
              }}
            >
              {doc.emergencyPickResolved ? "✅ Picking Error — Resolved" : "🚨 Picking Error — Pending"}
            </div>
            <div
              className="ip-hold-box"
              style={{
                marginBottom: 14,
                border: `1px solid ${doc.emergencyPickResolved ? "#34d399" : "#ef4444"}`,
                background: doc.emergencyPickResolved ? "rgba(52,211,153,0.08)" : "rgba(239,68,68,0.08)",
              }}
            >
              {row("Error Type", doc.pickingErrorReason)}
              {row("Wrong SKU / Description", doc.wrongMaterialSku)}
              {row("Quantity", doc.wrongMaterialQty)}
              {row("Re-picked By", doc.emergencyPickResolvedBy && `👤 ${doc.emergencyPickResolvedBy}`)}
            </div>
          </>
        )}

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Single Document Card ─────────────────────────────────────────────────────

function DocumentCard({ doc, requestId, onStart, onHold, onEnd, onView }) {
  const sc        = statusClass(doc.checkStatus);
  const jColor    = jobTypeColor(doc.jobType);
  const isPending = sc === "pending";
  const isStarted = sc === "inprogress";
  const isOnHold  = sc === "onhold";
  const isDone    = sc === "completed";

  const isFlagged = (doc.hasWrongMaterial || "").toUpperCase() === "YES";
  // Pick Portal hasn't re-picked yet — still an open picking error.
  const hasUnresolvedError = isFlagged && !doc.emergencyPickResolved && !isDone;
  // Pick Portal has confirmed Emergency Pick Done — error is cleared,
  // waiting on this Check to finish/confirm.
  const hasResolvedError = isFlagged && doc.emergencyPickResolved && !isDone;

  const cardClassName =
    `ip-card status-${sc}` +
    (hasUnresolvedError ? " ip-card-wrong-material" : "") +
    (hasResolvedError ? " ip-card-error-resolved" : "");

  const cardStyle = hasUnresolvedError
    ? {
        border: "2px solid #ef4444",
        boxShadow: "0 0 0 1px rgba(239,68,68,0.35), 0 0 16px rgba(239,68,68,0.25)",
        background: "rgba(239,68,68,0.06)",
      }
    : hasResolvedError
    ? {
        border: "2px solid #34d399",
        boxShadow: "0 0 0 1px rgba(52,211,153,0.35), 0 0 16px rgba(52,211,153,0.2)",
        background: "rgba(52,211,153,0.06)",
      }
    : undefined;

  return (
    <div className={cardClassName} style={cardStyle}>
      {hasUnresolvedError && (
        <div
          style={{
            background: "#ef4444",
            color: "#fff",
            fontWeight: 700,
            fontSize: "0.78rem",
            padding: "6px 12px",
            borderRadius: 6,
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          🚨 PICKING ERROR{doc.pickingErrorReason ? ` (${doc.pickingErrorReason})` : ""} — Emergency Pick Required
        </div>
      )}
      {hasResolvedError && (
        <div
          style={{
            background: "#34d399",
            color: "#06281c",
            fontWeight: 700,
            fontSize: "0.78rem",
            padding: "6px 12px",
            borderRadius: 6,
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          ✅ EMERGENCY PICK DONE — Re-picked, ready to continue check
        </div>
      )}

      {/* ── Head ── */}
      <div className="ip-card-head">
        <div>
          <div className="ip-doc-no">{requestId || "—"}</div>
          <div className="ip-doc-number-sub">
            Doc No: {doc.printDocumentNo ? doc.printDocumentNo : "Not entered"}
          </div>
          <div style={{ color: jColor, fontWeight: 700, fontSize: "0.78rem", marginTop: 2 }}>
            {doc.jobType || "—"}
          </div>
        </div>
        <span className={`ip-badge ${hasUnresolvedError ? "onhold" : hasResolvedError ? "completed" : sc}`}>
          {hasUnresolvedError
            ? "🚨 Picking Error Pending"
            : hasResolvedError
            ? "✅ Emergency Pick Done"
            : statusLabel(doc.checkStatus)}
        </span>
      </div>

      {/* ── Body ── */}
      <div className="ip-card-body">
        <div className="ip-detail-row">
          <span className="ip-detail-label">Requested By</span>
          <span className="ip-detail-value">{doc.requestedBy || "—"}</span>
        </div>
        <div className="ip-detail-row">
          <span className="ip-detail-label">Job WBS</span>
          <span className="ip-detail-value">{doc.jobwbs || "—"}</span>
        </div>
        <div className="ip-detail-row">
          <span className="ip-detail-label">Reservation No</span>
          <span className="ip-detail-value">{doc.reservationNo || "—"}</span>
        </div>
        <div className="ip-detail-row">
          <span className="ip-detail-label">Entered By</span>
          <span className="ip-detail-value">{doc.enteredBy || "—"}</span>
        </div>

        <div className="ip-times">
          <div className="ip-time-row">
            <span>Request Date</span>
            <span>{formatDate(doc.requestDate)}</span>
          </div>
          <div className="ip-time-row">
            <span>Request Time</span>
            <span>{formatTime(doc.requestTime)}</span>
          </div>
        </div>

        {/* Hold info banner */}
        {(isOnHold || doc.checkHoldReason) && (
          <div className="ip-hold-box">
            <div className="ip-hold-row">
              <span>⏸ Hold Reason</span>
              <span>{doc.checkHoldReason || "—"}</span>
            </div>
            <div className="ip-hold-row">
              <span>Held By</span>
              <span>👤 {doc.checkHeldBy || "—"}</span>
            </div>
            <div className="ip-hold-row">
              <span>Held At</span>
              <span>{formatDateTime(doc.checkHoldTime)}</span>
            </div>
          </div>
        )}

        {/* Wrong material info — reported at Hold time, shown as soon as it's known */}
        {isFlagged && (
          <div className="ip-wrong-material-box">
            <div className="ip-wrong-material-row">
              <span>{hasResolvedError ? "✅ Emergency Pick Done" : "⚠️ " + (doc.pickingErrorReason || "Wrong Material")}</span>
              <span>{doc.wrongMaterialSku || "—"}</span>
            </div>
            <div className="ip-wrong-material-row">
              <span>Quantity</span>
              <span>{doc.wrongMaterialQty || "—"}</span>
            </div>
            {hasResolvedError && (
              <div className="ip-wrong-material-row">
                <span>Re-picked By</span>
                <span>👤 {doc.emergencyPickResolvedBy || "—"}</span>
              </div>
            )}
          </div>
        )}

        {/* Collected Different Material — logged, but not a picking error */}
        {!isFlagged && doc.pickingErrorReason && (
          <div className="ip-hold-box">
            <div className="ip-hold-row">
              <span>ℹ️ Picking Note</span>
              <span>{doc.pickingErrorReason}</span>
            </div>
          </div>
        )}

        {/* Check Done summary */}
        {isDone && (
          <>
            {!isFlagged && !doc.pickingErrorReason && (
              <div className="ip-no-issue-box">✅ No material issues</div>
            )}

            <div className="ip-print-done-box">
              <div className="ip-print-done-row">
                <span>Checked By</span>
                <span>👤 {doc.checkedBy || "—"}</span>
              </div>
              <div className="ip-print-done-row">
                <span>Duration</span>
                <span>⏱ {formatDuration(doc.checkDurationSeconds)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Footer Buttons: Start | Hold | End | View ── */}
      <div className="ip-card-foot">
        <button
          className="ip-btn ip-btn-start"
          disabled={!(isPending || isOnHold)}
          onClick={() => onStart(doc.id)}
        >
          {isOnHold ? "▶ Resume" : "▶ Start"}
        </button>
        <button
          className="ip-btn ip-btn-hold"
          disabled={!isStarted}
          onClick={() => onHold(doc.id)}
        >
          ⏸ Hold
        </button>
        <button
          className="ip-btn ip-btn-end"
          disabled={!(isStarted || isOnHold)}
          onClick={() => onEnd(doc.id)}
        >
          ■ End
        </button>
        <button
          className="ip-btn ip-btn-outline"
          onClick={() => onView(doc.id)}
        >
          👁 View
        </button>
      </div>
    </div>
  );
}

// ── Skeleton Card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="ip-card status-pending">
      <div className="ip-card-head">
        <div>
          <div className="ip-skeleton" style={{ width: 100, height: 15, marginBottom: 6 }} />
          <div className="ip-skeleton" style={{ width: 70, height: 11 }} />
        </div>
        <div className="ip-skeleton" style={{ width: 72, height: 22, borderRadius: 12 }} />
      </div>
      <div className="ip-card-body">
        {[1,2,3,4].map(i => (
          <div key={i} className="ip-detail-row">
            <div className="ip-skeleton" style={{ width: 90, height: 11 }} />
            <div className="ip-skeleton" style={{ width: 130, height: 11 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function IssueCheckForm() {
  const [documents,    setDocuments]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [search,       setSearch]       = useState("");
  const [filterType,   setFilterType]   = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [fromDate,     setFromDate]     = useState("");
  const [toDate,       setToDate]       = useState("");
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const [refreshing,   setRefreshing]   = useState(false);

  const [activePopup,  setActivePopup]  = useState(null); // "hold" | "end" | "view" | null
  const [activeId,     setActiveId]     = useState(null);

  // ── Fetch ──
  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res  = await fetch(API_BASE);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      // Only bring documents into Check Portal once BOTH conditions are met:
      // 1) Pick Portal has marked the document as Pick Done (status = completed)
      // 2) Print Portal has already entered a document number for it
      const readyForCheck = data.filter(d => {
        const pickDone = statusClass(d.status) === "completed";
        const hasDocNo = d.printDocumentNo && String(d.printDocumentNo).trim() !== "";
        return pickDone && hasDocNo;
      });

      setDocuments(readyForCheck);
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

  // ── Start / Resume ──
  const handleStart = async (id) => {
    try {
      await fetch(`${API_BASE}/${id}/start`, { method: "PUT" });
      fetchDocuments(true);
    } catch (err) {
      alert("Start failed: " + err.message);
    }
  };

  const handleHoldClick = (id) => { setActiveId(id); setActivePopup("hold"); };
  const handleEndClick  = (id) => { setActiveId(id); setActivePopup("end"); };
  const handleViewClick = (id) => { setActiveId(id); setActivePopup("view"); };
  const closePopup = () => { setActivePopup(null); setActiveId(null); };

  const handleHoldConfirm = async (holdReason, heldBy, hasWrongMaterial, wrongMaterialSku, wrongMaterialQty, pickingErrorReason) => {
    closePopup();
    try {
      await fetch(`${API_BASE}/${activeId}/hold`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdReason, heldBy, hasWrongMaterial, wrongMaterialSku, wrongMaterialQty, pickingErrorReason }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Hold failed: " + err.message);
    }
  };

  const handleCheckDoneConfirm = async (checkedBy) => {
    closePopup();
    try {
      await fetch(`${API_BASE}/${activeId}/end`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkedBy }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Check Done failed: " + err.message);
    }
  };

  // Request ID: date + daily sequence, e.g. 20260816/0001 — same scheme as Pick/Print Portal
  const requestIdMap = useMemo(() => computeRequestIds(documents), [documents]);

  // Picking errors still open — Pick Portal hasn't re-picked yet.
  const activeErrorDocs = documents.filter(d => {
    const isFlagged = (d.hasWrongMaterial || "").toUpperCase() === "YES";
    return isFlagged && !d.emergencyPickResolved && statusClass(d.checkStatus) !== "completed";
  });

  // Picking errors Pick Portal has just resolved (Emergency Pick Done
  // confirmed) — still waiting for this Check to be finished/confirmed.
  const resolvedErrorDocs = documents.filter(d => {
    const isFlagged = (d.hasWrongMaterial || "").toUpperCase() === "YES";
    return isFlagged && d.emergencyPickResolved && statusClass(d.checkStatus) !== "completed";
  });

  // ── Filters ──
  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];
  const statuses = ["ALL", ...new Set(documents.map(d => d.checkStatus).filter(Boolean))];

  const visible = documents.filter(doc => {
    const q = search.toLowerCase();
    const matchSearch = !q || [
      String(doc.id), doc.requestedBy, doc.jobwbs,
      doc.reservationNo, doc.enteredBy, doc.jobType,
    ].some(v => (v || "").toLowerCase().includes(q));

    const matchType   = filterType   === "ALL" || doc.jobType === filterType;
    const matchStatus = filterStatus === "ALL" || doc.checkStatus === filterStatus;

    const docDate = doc.requestDate;
    const matchFrom = !fromDate || (docDate && docDate >= fromDate);
    const matchTo   = !toDate   || (docDate && docDate <= toDate);
    const matchDate = matchFrom && matchTo;

    return matchSearch && matchType && matchStatus && matchDate;
  });

  // Stats
  const total     = documents.length;
  const pending   = documents.filter(d => statusClass(d.checkStatus) === "pending").length;
  const inProg    = documents.filter(d => statusClass(d.checkStatus) === "inprogress").length;
  const onHold    = documents.filter(d => statusClass(d.checkStatus) === "onhold").length;
  const completed = documents.filter(d => statusClass(d.checkStatus) === "completed").length;
  const wrongCount = documents.filter(d => (d.hasWrongMaterial || "").toUpperCase() === "YES").length;

  const viewingDoc = documents.find(d => d.id === activeId) || null;

  return (
    <div className="ip-page">

      {activePopup === "hold" && (
        <HoldPopup onConfirm={handleHoldConfirm} onCancel={closePopup} />
      )}
      {activePopup === "end" && (
        <CheckDonePopup onConfirm={handleCheckDoneConfirm} onCancel={closePopup} />
      )}
      {activePopup === "view" && (
        <ViewDetailsPopup doc={viewingDoc} onClose={closePopup} />
      )}

      {/* ── Header ── */}
      <div className="ip-header">
        <div className="ip-header-left">
          <h1>✅ Check Portal</h1>
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

      {/* ── Active Picking Error Notification Bar ── */}
      {activeErrorDocs.length > 0 && (
        <div
          style={{
            background: "rgba(239,68,68,0.15)",
            border: "1px solid #ef4444",
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: 18,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ color: "#ef4444", fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
            🚨 {activeErrorDocs.length} Picking Error{activeErrorDocs.length > 1 ? "s" : ""} Pending — waiting on Pick Portal
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {activeErrorDocs.map(d => (
              <span
                key={d.id}
                style={{
                  background: "#ef4444",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "0.78rem",
                  padding: "4px 10px",
                  borderRadius: 6,
                }}
              >
                {requestIdMap[d.id] || "—"} · Doc No: {d.printDocumentNo || "—"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Resolved Picking Error Notification Bar ── */}
      {resolvedErrorDocs.length > 0 && (
        <div
          style={{
            background: "rgba(52,211,153,0.15)",
            border: "1px solid #34d399",
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: 18,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ color: "#34d399", fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
            ✅ {resolvedErrorDocs.length} Emergency Pick{resolvedErrorDocs.length > 1 ? "s" : ""} Done — re-picked, ready to continue check
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {resolvedErrorDocs.map(d => (
              <span
                key={d.id}
                style={{
                  background: "#34d399",
                  color: "#06281c",
                  fontWeight: 600,
                  fontSize: "0.78rem",
                  padding: "4px 10px",
                  borderRadius: 6,
                }}
              >
                {requestIdMap[d.id] || "—"} · Doc No: {d.printDocumentNo || "—"} · Emergency Pick Done
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="ip-toolbar">
        <div className="ip-search-wrap">
          <span className="ip-search-icon">🔍</span>
          <input
            className="ip-search"
            type="text"
            placeholder="Search by ID, Requested By, WBS, Reservation..."
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
        {/* <DateRangeFilter
          fromDate={fromDate}
          toDate={toDate}
          onChange={(f, t) => { setFromDate(f); setToDate(t); }}
          onClear={() => { setFromDate(""); setToDate(""); }}
        /> */}
      </div>

      {/* ── Stats ── */}
      <div className="ip-stats">
        <div className="ip-stat-chip blue">Total <strong>{total}</strong></div>
        <div className="ip-stat-chip"><strong style={{color:"#f59e0b"}}>{pending}</strong> Pending</div>
        <div className="ip-stat-chip"><strong style={{color:"#3b82f6"}}>{inProg}</strong> In Progress</div>
        <div className="ip-stat-chip"><strong style={{color:"#fb923c"}}>{onHold}</strong> On Hold</div>
        <div className="ip-stat-chip green">Check Done <strong>{completed}</strong></div>
        {wrongCount > 0 && (
          <div className="ip-stat-chip" style={{ background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444" }}>
            <strong style={{ color: "#ef4444" }}>{wrongCount}</strong> ⚠️ Wrong Material
          </div>
        )}
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

      {/* ── Grid ── */}
      <div className="ip-grid">
        {loading ? (
          [1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)
        ) : visible.length === 0 ? (
          <div className="ip-empty">
            <div className="ip-empty-icon">📭</div>
            <p>No documents found{search ? ` for "${search}"` : ""}.</p>
          </div>
        ) : (
          visible.map(doc => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              requestId={requestIdMap[doc.id]}
              onStart={handleStart}
              onHold={handleHoldClick}
              onEnd={handleEndClick}
              onView={handleViewClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
