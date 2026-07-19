import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./IssuePick.css";

const API_BASE = "http://localhost:8080/api/pick-portal";
// Master Setup API — same base the Admin Dashboard's "Master Setup → Picker"
// panel saves to. We read from here so Held By / Picked By / Emergency Pick By
// always match whatever names are entered in Admin Dashboard, live from the DB.
const SETUP_API = "http://localhost:8080/api/admin-setup";
const AUTO_REFRESH = 10000;
const PICKER_REFRESH = 15000;

const HOLD_REASONS = [
  "Printer not available",
  "Material shortage",
  "Waiting for approval",
  "Machine breakdown",
  "Other",
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

// Groups documents by their request date and numbers each group starting
// from 1, then combines that with the date to build a unique Request ID
// like 20260816/0001. Resets automatically whenever the date changes.
// (Same logic as the Print Portal, so IDs read consistently across portals.)
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

// ── Picker names — live from Master Setup (DB) ──────────────────────────────
// Replaces the old hardcoded PEOPLE_OPTIONS list. Reads the same "/pickers"
// table that Admin Dashboard → Master Setup → Picker writes to, so adding /
// editing / deleting a picker there shows up here automatically (polled).

function usePickerNames() {
  const [names, setNames] = useState([]);

  const load = useCallback(() => {
    fetch(`${SETUP_API}/pickers`)
      .then(res => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setNames(
          (Array.isArray(data) ? data : [])
            .map(p => p.pickerName)
            .filter(Boolean)
        );
      })
      .catch(() => { /* keep last known list on transient errors */ });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, PICKER_REFRESH);
    return () => clearInterval(id);
  }, [load]);

  return names;
}

// ── Status helpers ────────────────────────────────────────────────────────────
// Internal state machine (drives button enabling / accent colors):
//   PENDING → [Handover] → HANDED_OVER → [Start] → IN_PROGRESS
//   IN_PROGRESS → [Hold] → ON_HOLD → [Start = Resume] → IN_PROGRESS
//   IN_PROGRESS / ON_HOLD → [End] → COMPLETED
// (Handover step moved here from the Print Portal.)

function statusClass(s) {
  const v = (s || "").toLowerCase();
  if (v.includes("hold"))     return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("complete") || v.includes("done")) return "completed";
  if (v.includes("handed"))   return "handedover";
  return "pending";
}

function statusLabel(s) {
  const c = statusClass(s);
  return {
    pending: "Pending",
    handedover: "Handovered",
    inprogress: "In Progress",
    onhold: "On Hold",
    completed: "Pick Done",
  }[c];
}

// ── Generic Person Picker ──────────────────────────────────────────────────
// Now driven purely by the `options` prop (Master Setup picker names).
// "Other" free-text entry has been removed — only names that exist in the
// Picker master table can be selected, so whatever gets saved to the DB
// (heldBy / pickedBy / resolvedBy / handedOverBy) always matches Master Setup.

function PersonPicker({ value, onChange, options }) {
  if (!options || options.length === 0) {
    return (
      <div className="ip-popup-options">
        <div style={{ color: "#7c8db0", fontSize: "0.8rem", padding: "8px 2px" }}>
          No pickers set up yet. Add names in Admin Dashboard → Master Setup → Picker.
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

// ── Popup: Handover (Step 1 — separate from Start) ────────────────────────────

function HandoverPopup({ pickerNames, onConfirm, onCancel }) {
  const [handedOverBy, setHandedOverBy] = useState("");

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>🚀 Handover Document</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select who is handing over this document to pick</p>

        <span className="ip-popup-label">Handed Over By</span>
        <PersonPicker value={handedOverBy} onChange={setHandedOverBy} options={pickerNames} />

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-handover"
            disabled={!handedOverBy}
            onClick={() => onConfirm(handedOverBy)}
          >
            🚀 Confirm Handover
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: Hold Reason + Held By ────────────────────────────────────────────

function HoldPopup({ pickerNames, onConfirm, onCancel }) {
  const [reason, setReason]   = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [heldBy, setHeldBy]   = useState("");

  const isOtherReason = reason === "Other";
  const finalReason   = isOtherReason ? otherReason.trim() : reason;
  const canConfirm     = !!finalReason && !!heldBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>⏸ Hold Document</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select a reason and who is putting this on hold</p>

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Hold Reason
        </div>
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

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Held By
        </div>
        <PersonPicker value={heldBy} onChange={setHeldBy} options={pickerNames} />

        <div className="ip-popup-foot" style={{ marginTop: 18 }}>
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

// ── Popup: Picked By (End) ──────────────────────────────────────────────────

function PickedByPopup({ pickerNames, onConfirm, onCancel }) {
  const [pickedBy, setPickedBy] = useState("");

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>👤 Who Picked This?</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select the person who completed this pick</p>

        <PersonPicker value={pickedBy} onChange={setPickedBy} options={pickerNames} />

        <div className="ip-popup-foot" style={{ marginTop: 18 }}>
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            disabled={!pickedBy}
            onClick={() => onConfirm(pickedBy)}
          >
            ✅ Pick Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: Emergency Pick Done (re-pick after Check reported an error) ──────

function EmergencyPickDonePopup({ pickerNames, onConfirm, onCancel }) {
  const [resolvedBy, setResolvedBy] = useState("");

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>🚨 Emergency Pick Done</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select who re-picked the correct material</p>

        <PersonPicker value={resolvedBy} onChange={setResolvedBy} options={pickerNames} />

        <div className="ip-popup-foot" style={{ marginTop: 18 }}>
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            disabled={!resolvedBy}
            onClick={() => onConfirm(resolvedBy)}
          >
            🚨 Confirm Emergency Pick Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: View Full Details ─────────────────────────────────────────────────

function ViewDetailsPopup({ doc, requestId, onClose }) {
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
          <span>📋 Full Details — {requestId || "—"}</span>
          <button className="ip-popup-close" onClick={onClose}>✕</button>
        </div>
        <p className="ip-popup-sub">Complete history for this document</p>

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Document Info
        </div>
        <div className="ip-hold-box" style={{ marginBottom: 14 }}>
          {row("Job WBS", doc.jobwbs)}
          {row("Reservation No", doc.reservationNo)}
          {row("Entered By", doc.enteredBy)}
          {row("Job Type", doc.jobType)}
          {row("Request Date", formatDate(doc.requestDate))}
          {row("Request Time", formatTime(doc.requestTime))}
        </div>

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Handover
        </div>
        <div className="ip-hold-box" style={{ marginBottom: 14 }}>
          {row("Handed Over By", doc.handedOverBy && `👤 ${doc.handedOverBy}`)}
        </div>

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Start / Hold
        </div>
        <div className="ip-hold-box" style={{ marginBottom: 14 }}>
          {row("Start Time", formatDateTime(doc.startTime))}
          {row("Hold Reason", doc.holdReason)}
          {row("Held By", doc.heldBy && `👤 ${doc.heldBy}`)}
          {row("Held At", formatDateTime(doc.holdTime))}
        </div>

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Pick Done
        </div>
        <div className="ip-hold-box" style={{ marginBottom: 14 }}>
          {row("Picked By", doc.pickedBy && `👤 ${doc.pickedBy}`)}
          {row("Total Duration", `⏱ ${formatDuration(doc.durationSeconds)}`)}
        </div>

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Print Portal
        </div>
        <div className="ip-hold-box" style={{ marginBottom: 14 }}>
          {row("Document Number", doc.printDocumentNo)}
          {row("Vehicle Number", doc.vehicleNo)}
          {row("Print Hold Reason", doc.printHoldReason)}
          {row("Print Held By", doc.printHeldBy && `👤 ${doc.printHeldBy}`)}
          {row("Print Held At", formatDateTime(doc.printHoldTime))}
          {row("Printed By", doc.printedBy && `👤 ${doc.printedBy}`)}
          {row("Print Duration", `⏱ ${formatDuration(doc.printDurationSeconds)}`)}
        </div>

        {(doc.hasWrongMaterial || "").toUpperCase() === "YES" && !doc.emergencyPickResolved && (
          <>
            <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#ef4444", fontWeight: 700 }}>
              🚨 Check Portal — Wrong Material Reported
            </div>
            <div
              className="ip-hold-box"
              style={{ marginBottom: 14, border: "1px solid #ef4444", background: "rgba(239,68,68,0.08)" }}
            >
              {row("Checked By", doc.checkedBy && `👤 ${doc.checkedBy}`)}
              {row("Wrong SKU / Description", doc.wrongMaterialSku)}
              {row("Quantity", doc.wrongMaterialQty)}
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

// ── Popup: New Picking Error Alert (from Check Portal) ──────────────────────
// Pops up once per new error (not on every poll) alongside the persistent
// notification bar. Each item is clickable and jumps/scrolls to the matching
// document card in the grid below.

function PickingErrorAlertPopup({ docs, requestIdMap, onJump, onClose }) {
  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>🚨 New Picking Error{docs.length > 1 ? "s" : ""} Reported</span>
          <button className="ip-popup-close" onClick={onClose}>✕</button>
        </div>
        <p className="ip-popup-sub">
          Check Portal found {docs.length} issue{docs.length > 1 ? "s" : ""} — click one to jump to it
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {docs.map(d => (
            <button
              key={d.id}
              onClick={() => onJump(d.id)}
              style={{
                textAlign: "left",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid #ef4444",
                borderRadius: 8,
                padding: "10px 12px",
                cursor: "pointer",
                color: "#fff",
              }}
            >
              <div style={{ fontWeight: 700, color: "#ef4444", marginBottom: 4 }}>
                {requestIdMap[d.id] || "—"} · Doc No: {d.printDocumentNo || "—"}
              </div>
              <div style={{ fontSize: "0.8rem", color: "#fca5a5" }}>
                {d.pickingErrorReason ? `${d.pickingErrorReason} · ` : ""}
                {d.wrongMaterialSku ? `SKU: ${d.wrongMaterialSku}` : ""}
                {d.wrongMaterialQty ? ` · Qty: ${d.wrongMaterialQty}` : ""}
              </div>
            </button>
          ))}
        </div>

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Single Document Card ─────────────────────────────────────────────────────

function DocumentCard({ doc, requestId, onHandover, onStart, onHold, onEnd, onView, onEmergencyDone, cardRef, jumpHighlighted }) {
  const sc        = statusClass(doc.status);
  const jColor    = jobTypeColor(doc.jobType);
  const isPending    = sc === "pending";
  const isHandedOver = sc === "handedover";   // handed over, not started yet
  const isStarted    = sc === "inprogress";
  const isOnHold      = sc === "onhold";
  const isDone         = sc === "completed";

  const canHandover = isPending;
  const canStart     = isHandedOver || isOnHold;   // Start = also acts as Resume
  const canHold       = isStarted;
  const canEnd        = isStarted || isOnHold;

  // Check Portal flags this document if a wrong-material issue was found
  // during checking — surface it urgently back here on the Pick card,
  // until it's been resolved with an Emergency Pick Done.
  const hasCheckError =
    (doc.hasWrongMaterial || "").toUpperCase() === "YES" && !doc.emergencyPickResolved;

  const cardClassName = `ip-card status-${sc}${hasCheckError ? " ip-card-emergency" : ""}`;
  const cardStyle = hasCheckError
    ? {
        border: "2px solid #ef4444",
        boxShadow: "0 0 0 1px rgba(239,68,68,0.35), 0 0 16px rgba(239,68,68,0.25)",
        background: "rgba(239,68,68,0.06)",
      }
    : undefined;

  // Extra pulsing ring shown briefly right after jumping here from the
  // "New Picking Error" alert popup, so it's obvious which card it meant.
  const jumpStyle = jumpHighlighted
    ? {
        outline: "3px solid #facc15",
        outlineOffset: 2,
        transition: "outline-color 0.3s ease",
      }
    : undefined;

  return (
    <div ref={cardRef} className={cardClassName} style={{ ...cardStyle, ...jumpStyle }}>
      {hasCheckError && (
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
          🚨 EMERGENCY PICK ERROR — Wrong Material Found at Check
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
        <span className={`ip-badge ${sc}`}>{statusLabel(doc.status)}</span>
      </div>

      {/* ── Body ── */}
      <div className="ip-card-body">
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

        {/* Handed Over info — shown from the moment Handover is confirmed */}
        {!isPending && doc.handedOverBy && (
          <div className="ip-handover-box">
            <div className="ip-handover-row">
              <span>🚀 Handed Over By</span>
              <span>👤 {doc.handedOverBy}</span>
            </div>
          </div>
        )}

        {/* Hold info banner */}
        {(isOnHold || doc.holdReason) && (
          <div className="ip-hold-box">
            <div className="ip-hold-row">
              <span>⏸ Hold Reason</span>
              <span>{doc.holdReason || "—"}</span>
            </div>
            <div className="ip-hold-row">
              <span>Held By</span>
              <span>👤 {doc.heldBy || "—"}</span>
            </div>
            <div className="ip-hold-row">
              <span>Held At</span>
              <span>{formatDateTime(doc.holdTime)}</span>
            </div>
          </div>
        )}

        {/* Duration + Picked By info (only when completed) */}
        {isDone && (
          <div className="ip-duration-box">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="ip-duration-label">Picked By</span>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#e2e8f0" }}>
                👤 {doc.pickedBy || "—"}
              </span>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="ip-duration-label">Total Duration</span>
              <div className="ip-duration-value">⏱ {formatDuration(doc.durationSeconds)}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer Buttons: Handover | Start | Hold | End | View ── */}
      <div className="ip-card-foot">
        <button
          className="ip-btn ip-btn-handover-action"
          disabled={!canHandover}
          onClick={() => onHandover(doc.id)}
        >
          🚀 Handover
        </button>
        <button
          className="ip-btn ip-btn-start"
          disabled={!canStart}
          onClick={() => onStart(doc.id)}
        >
          {isOnHold ? "▶ Resume" : "▶ Start"}
        </button>
        <button
          className="ip-btn ip-btn-hold"
          disabled={!canHold}
          onClick={() => onHold(doc.id)}
        >
          ⏸ Hold
        </button>
        <button
          className="ip-btn ip-btn-end"
          disabled={!canEnd}
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
        {hasCheckError && (
          <button
            className="ip-btn"
            style={{ background: "#ef4444", color: "#fff", fontWeight: 700 }}
            onClick={() => onEmergencyDone(doc.id)}
          >
            🚨 Emergency Pick Done
          </button>
        )}
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

export default function IssuPrinFormt() {
  const [documents,    setDocuments]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [search,       setSearch]       = useState("");
  const [filterType,   setFilterType]   = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const [refreshing,   setRefreshing]   = useState(false);

  // Picker names — live from Admin Dashboard → Master Setup → Picker (DB).
  const pickerNames = usePickerNames();

  // Popup state
  const [activePopup,  setActivePopup]  = useState(null); // "handover" | "hold" | "end" | "view" | "emergency" | null
  const [activeId,     setActiveId]     = useState(null);

  // "New Picking Error" alert popup (separate from activePopup — auto-triggered
  // when Check Portal reports a fresh error, on top of the notification bar).
  const [errorAlertDocs, setErrorAlertDocs] = useState([]); // docs waiting to be acknowledged
  const [seenErrorIds,   setSeenErrorIds]   = useState(() => new Set()); // ids already alerted for

  // Card scroll/highlight — used by the alert popup's "jump to card" click
  const cardRefs = useRef({});
  const [jumpHighlightId, setJumpHighlightId] = useState(null);

  const handleJumpToCard = (id) => {
    setErrorAlertDocs([]); // close the alert popup
    const el = cardRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setJumpHighlightId(id);
    setTimeout(() => setJumpHighlightId(prev => (prev === id ? null : prev)), 2500);
  };

  // ── Fetch ──
  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res  = await fetch(API_BASE);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      // Only show documents that have already been given a Print Document Number
      // in the Print Portal — undocumented ones stay hidden from Pick Portal.
      const withPrintDocNo = data.filter(
        d => d.printDocumentNo && String(d.printDocumentNo).trim() !== ""
      );

      setDocuments(withPrintDocNo);
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

  // ── Open popups ──
  const handleHandoverClick = (id) => { setActiveId(id); setActivePopup("handover"); };
  const handleHoldClick     = (id) => { setActiveId(id); setActivePopup("hold"); };
  const handleEndClick      = (id) => { setActiveId(id); setActivePopup("end"); };
  const handleViewClick     = (id) => { setActiveId(id); setActivePopup("view"); };
  const handleEmergencyClick = (id) => { setActiveId(id); setActivePopup("emergency"); };
  const closePopup = () => { setActivePopup(null); setActiveId(null); };

  // ── Confirm Handover ──
  const handleHandoverConfirm = async (handedOverBy) => {
    const id = activeId; closePopup();
    try {
      await fetch(`${API_BASE}/${id}/handover`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handedOverBy }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Handover failed: " + err.message);
    }
  };

  // ── Start / Resume ──
  const handleStart = async (id) => {
    try {
      await fetch(`${API_BASE}/${id}/start`, { method: "PUT" });
      fetchDocuments(true);
    } catch (err) {
      alert("Start failed: " + err.message);
    }
  };

  // ── Confirm Hold ──
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

  // ── Confirm End ──
  const handleEndConfirm = async (pickedBy) => {
    closePopup();
    try {
      await fetch(`${API_BASE}/${activeId}/end`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickedBy }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("End failed: " + err.message);
    }
  };

  // ── Confirm Emergency Pick Done (re-pick after Check reported wrong material) ──
  const handleEmergencyConfirm = async (resolvedBy) => {
    closePopup();
    try {
      await fetch(`${API_BASE}/${activeId}/emergency-resolve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolvedBy }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Emergency Pick Done failed: " + err.message);
    }
  };

  // Request ID: date + daily sequence, e.g. 20260816/0001 — same scheme as Print Portal
  const requestIdMap = useMemo(() => computeRequestIds(documents), [documents]);

  // Picking errors reported by Check Portal that are still unresolved —
  // shown as a persistent notification bar at the top, same style as the
  // Check Portal's own error bar.
  const activeCheckErrorDocs = useMemo(
    () => documents.filter(d =>
      (d.hasWrongMaterial || "").toUpperCase() === "YES" && !d.emergencyPickResolved
    ),
    [documents]
  );

  // Whenever a NEW picking error shows up (one we haven't alerted for yet),
  // queue it into the popup. Runs once per new error, not on every 10s poll —
  // and if a doc's error later gets resolved and then re-flagged, it can
  // alert again since it drops out of "seen" once resolved.
  useEffect(() => {
    setSeenErrorIds(prevSeen => {
      const newOnes = activeCheckErrorDocs.filter(d => !prevSeen.has(d.id));
      if (newOnes.length > 0) {
        setErrorAlertDocs(prevAlert => {
          const existingIds = new Set(prevAlert.map(d => d.id));
          return [...prevAlert, ...newOnes.filter(d => !existingIds.has(d.id))];
        });
      }
      return new Set(activeCheckErrorDocs.map(d => d.id));
    });
  }, [activeCheckErrorDocs]);

  // ── Filters ──
  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];

  const STATUS_FILTERS = [
    { value: "ALL",        label: "All Status" },
    { value: "pending",    label: "Pending" },
    { value: "handedover", label: "Handovered" },
    { value: "inprogress", label: "In Progress" },
    { value: "onhold",     label: "On Hold" },
    { value: "completed",  label: "Pick Done" },
  ];

  const visible = documents.filter(doc => {
    const q = search.toLowerCase();
    const matchSearch = !q || [
      String(doc.id), doc.jobwbs,
      doc.reservationNo, doc.enteredBy, doc.jobType,
    ].some(v => (v || "").toLowerCase().includes(q));

    const matchType   = filterType   === "ALL" || doc.jobType === filterType;
    const matchStatus = filterStatus === "ALL" || statusClass(doc.status) === filterStatus;

    return matchSearch && matchType && matchStatus;
  });

  // Stats
  const total       = documents.length;
  const pending     = documents.filter(d => statusClass(d.status) === "pending").length;
  const handedOver  = documents.filter(d => statusClass(d.status) === "handedover").length;
  const inProg      = documents.filter(d => statusClass(d.status) === "inprogress").length;
  const onHold      = documents.filter(d => statusClass(d.status) === "onhold").length;
  const completed   = documents.filter(d => statusClass(d.status) === "completed").length;

  // The doc currently open in the View popup
  const viewingDoc = documents.find(d => d.id === activeId) || null;

  return (
    <div className="ip-page">

      {/* Popups */}
      {activePopup === "handover" && (
        <HandoverPopup pickerNames={pickerNames} onConfirm={handleHandoverConfirm} onCancel={closePopup} />
      )}
      {activePopup === "hold" && (
        <HoldPopup pickerNames={pickerNames} onConfirm={handleHoldConfirm} onCancel={closePopup} />
      )}
      {activePopup === "end" && (
        <PickedByPopup pickerNames={pickerNames} onConfirm={handleEndConfirm} onCancel={closePopup} />
      )}
      {activePopup === "view" && (
        <ViewDetailsPopup
          doc={viewingDoc}
          requestId={activeId ? requestIdMap[activeId] : null}
          onClose={closePopup}
        />
      )}
      {activePopup === "emergency" && (
        <EmergencyPickDonePopup pickerNames={pickerNames} onConfirm={handleEmergencyConfirm} onCancel={closePopup} />
      )}
      {errorAlertDocs.length > 0 && (
        <PickingErrorAlertPopup
          docs={errorAlertDocs}
          requestIdMap={requestIdMap}
          onJump={handleJumpToCard}
          onClose={() => setErrorAlertDocs([])}
        />
      )}

      {/* ── Header ── */}
     <div className="ip-header">
        <div className="ip-header-left">
          <h1>LOGITRACK-WAREHOUSE TIME EFFICENCY TRACKER SYSTEM</h1>
          <h1>  Pick Portal</h1>
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
      {activeCheckErrorDocs.length > 0 && (
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
            🚨 {activeCheckErrorDocs.length} Picking Error{activeCheckErrorDocs.length > 1 ? "s" : ""} Reported by Check Portal — needs Emergency Pick
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {activeCheckErrorDocs.map(d => (
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

      {/* ── Toolbar ── */}
      <div className="ip-toolbar">
        <div className="ip-search-wrap">
          <span className="ip-search-icon">🔍</span>
          <input
            className="ip-search"
            type="text"
            placeholder="Search by ID, WBS, Reservation, Entered By..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="ip-filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          {jobTypes.map(t => <option key={t} value={t}>{t === "ALL" ? "All Job Types" : t}</option>)}
        </select>
        <select className="ip-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {STATUS_FILTERS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </div>

      {/* ── Stats ── */}
      <div className="ip-stats">
        <div className="ip-stat-chip blue">Total <strong>{total}</strong></div>
        <div className="ip-stat-chip"><strong style={{color:"#f59e0b"}}>{pending}</strong> Pending</div>
        <div className="ip-stat-chip"><strong style={{color:"#3b82f6"}}>{handedOver}</strong> Handovered</div>
        <div className="ip-stat-chip"><strong style={{color:"#3b82f6"}}>{inProg}</strong> In Progress</div>
        <div className="ip-stat-chip"><strong style={{color:"#fb923c"}}>{onHold}</strong> On Hold</div>
        <div className="ip-stat-chip green">Done <strong>{completed}</strong></div>
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
              onHandover={handleHandoverClick}
              onStart={handleStart}
              onHold={handleHoldClick}
              onEnd={handleEndClick}
              onView={handleViewClick}
              onEmergencyDone={handleEmergencyClick}
              cardRef={el => { cardRefs.current[doc.id] = el; }}
              jumpHighlighted={jumpHighlightId === doc.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
