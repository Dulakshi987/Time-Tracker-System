import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./IssuePick.css";
import { getCurrentUser, canUseButton } from "../../config/permissions"; // adjust path to your project structure

// const API_BASE = "http://localhost:8080/api/pick-portal";
// const SETUP_API = "http://localhost:8080/api/admin-setup";
const API_BASE = "https://time-tracker-system-production.up.railway.app/api/pick-portal";
const SETUP_API = "https://time-tracker-system-production.up.railway.app/api/admin-setup";
const AUTO_REFRESH = 10000;

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

// Same scheme as Print Portal — groups by request date, numbers within the
// day, e.g. 20260816/0001. Resets automatically when the date changes.
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

function jobTypeColor(jt) {
  const map = {
    balance: "#a78bfa", domestic: "#34d399", cost_center: "#f59e0b",
    commercial: "#3b82f6", sales_order: "#f472b6",
  };
  return map[(jt || "").toLowerCase().replace(/\s+/g, "_")] || "#7c8db0";
}

// ── Status helpers ───────────────────────────────────────────────────────────
// PENDING → [Handover] → HANDED_OVER → [Start] → IN_PROGRESS
// IN_PROGRESS → [Hold] → ON_HOLD → [Start = Resume] → IN_PROGRESS
// IN_PROGRESS / ON_HOLD → [End] → COMPLETED

function statusClass(s) {
  const v = (s || "").toLowerCase();
  if (v.includes("hold")) return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("complete") || v.includes("done")) return "completed";
  if (v.includes("handed")) return "handedover";
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

// Parses the reason-wise SKU/Qty groups saved by the Check Portal's Hold
// popup. New format: "Reason::sku1,sku2||Reason2::sku3" (self-labelled
// groups, one per picking-error reason, each with its own SKU/Qty list).
// Falls back to the old flat format (single reason, single SKU/Qty list)
// for records saved before this change.
function parsePickingErrorGroups(doc) {
  const sku = doc.wrongMaterialSku || "";
  const qty = doc.wrongMaterialQty || "";
  if (!sku && !qty) return [];

  if (!sku.includes("::")) {
    return [{
      reason: doc.pickingErrorReason || "",
      skus: sku.split(/[;,]/).map(s => s.trim()).filter(Boolean),
      qtys: qty.split(/[;,]/).map(s => s.trim()).filter(Boolean),
    }];
  }

  const parseField = (field) =>
    field.split("||").map(g => g.trim()).filter(Boolean).map(g => {
      const idx = g.indexOf("::");
      const label = idx >= 0 ? g.slice(0, idx).trim() : "";
      const list = idx >= 0 ? g.slice(idx + 2) : g;
      return { label, items: list.split(",").map(s => s.trim()).filter(Boolean) };
    });

  const skuGroups = parseField(sku);
  const qtyGroups = parseField(qty);

  return skuGroups.map((g, i) => ({
    reason: g.label,
    skus: g.items,
    qtys: (qtyGroups[i] && qtyGroups[i].items) || [],
  }));
}

// ── Person Picker (division-scoped — Only Master Data, no "Other") ─────────
// Mirrors the Print Portal's PersonPicker exactly: the `people` list handed
// in is already filtered down to whichever Division the current document
// belongs to, so whatever gets picked here always matches Admin Master Setup
// for that division.
function PersonPicker({ value, onChange, people, loading }) {
  return (
    <div className="ip-popup-options">
      {loading ? (
        <div className="ip-popup-empty">Loading pickers…</div>
      ) : people.length === 0 ? (
        <div className="ip-popup-empty">No pickers found for this division in Master Setup</div>
      ) : (
        people.map(name => (
          <button
            key={name}
            className={`ip-popup-option ${value === name ? "selected" : ""}`}
            onClick={() => onChange(name)}
          >
            👤 {name}
          </button>
        ))
      )}
    </div>
  );
}

// ── Popup: Handover (Step 1) ─────────────────────────────────────────────────
function HandoverPopup({ onConfirm, onCancel, pickers, pickersLoading }) {
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
        <PersonPicker value={handedOverBy} onChange={setHandedOverBy} people={pickers} loading={pickersLoading} />

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
function HoldPopup({ onConfirm, onCancel, pickers, pickersLoading }) {
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [heldBy, setHeldBy] = useState("");

  const isOtherReason = reason === "Other";
  const finalReason = isOtherReason ? otherReason.trim() : reason;
  const canConfirm = !!finalReason && !!heldBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>⏸ Hold Document</span>
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
        <PersonPicker value={heldBy} onChange={setHeldBy} people={pickers} loading={pickersLoading} />

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

// ── Popup: Picked By (End) ───────────────────────────────────────────────────
function PickedByPopup({ onConfirm, onCancel, pickers, pickersLoading }) {
  const [pickedBy, setPickedBy] = useState("");

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>👤 Who Picked This?</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select the person who completed this pick</p>

        <PersonPicker value={pickedBy} onChange={setPickedBy} people={pickers} loading={pickersLoading} />

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
// Every picking-error reason logged by the Check Portal is shown here as its
// own group with its own SKU + Quantity, so the person knows exactly what to
// re-pick before they confirm and pick their name below.
function EmergencyPickDonePopup({ doc, onConfirm, onCancel, pickers, pickersLoading }) {
  const [resolvedBy, setResolvedBy] = useState("");
  const groups = parsePickingErrorGroups(doc);

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>🚨 Emergency Pick Done</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select who re-picked the correct material</p>

        {groups.map((g, i) => (
          <div
            key={i}
            style={{
              marginBottom: 10,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid #ef4444",
              borderLeft: "4px solid #ef4444",
              borderRadius: 10,
              padding: 15,
            }}
          >
            <div style={{ color: "#ef4444", fontWeight: 700, marginBottom: 8 }}>
              ⚠️ {g.reason || "Reason"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>SKU / Description</span>
              <span>{g.skus.join(", ") || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600 }}>Quantity</span>
              <span>{g.qtys.join(", ") || "—"}</span>
            </div>
          </div>
        ))}

        <span className="ip-popup-label">Re-picked By</span>
        <PersonPicker value={resolvedBy} onChange={setResolvedBy} people={pickers} loading={pickersLoading} />

        <div className="ip-popup-foot" style={{ marginTop: 18 }}>
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            style={{ background: "#ef4444" }}
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

// ── Popup: Edit (Held By / Picked By only) — mirrors Print Portal's Edit ────
function EditPopup({ doc, onConfirm, onCancel, pickers, pickersLoading }) {
  const [heldBy, setHeldBy] = useState(doc?.heldBy || "");
  const [pickedBy, setPickedBy] = useState(doc?.pickedBy || "");

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>✏ Edit Document</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Only Held By and Picked By (End By) can be changed here</p>

        <span className="ip-popup-label">Held By</span>
        <PersonPicker value={heldBy} onChange={setHeldBy} people={pickers} loading={pickersLoading} />

        <span className="ip-popup-label" style={{ marginTop: 14, display: "block" }}>
          Picked By (End By)
        </span>
        <PersonPicker value={pickedBy} onChange={setPickedBy} people={pickers} loading={pickersLoading} />

        <div className="ip-popup-foot" style={{ marginTop: 18 }}>
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            onClick={() => onConfirm({ heldBy, pickedBy })}
          >
            💾 Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: View Full Details ─────────────────────────────────────────────────
function ViewDetailsPopup({ doc, requestId, divisionLabel, onClose }) {
  if (!doc) return null;

  const row = (label, value) => (
    <div className="ip-hold-row" key={label}>
      <span>{label}</span>
      <span>{value ?? "—"}</span>
    </div>
  );

  const isFlagged = (doc.hasWrongMaterial || "").toUpperCase() === "YES";

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
          {row("Division", divisionLabel || "—")}
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

        {/* Picking error section — each reason (Shortage / Collected
            Different Material) shown as its own group with its own SKU +
            Quantity, both while pending AND after it's been resolved, so
            the full picture stays visible in the history. */}
        {isFlagged && (() => {
          const groups = parsePickingErrorGroups(doc);
          return (
            <>
              <div
                style={{
                  marginBottom: 6, fontSize: "0.78rem", fontWeight: 700,
                  color: doc.emergencyPickResolved ? "#16a34a" : "#ef4444",
                }}
              >
                {doc.emergencyPickResolved
                  ? "✅ Picking Error — Resolved"
                  : "🚨 Check Portal — Wrong Material Reported"}
              </div>
              <div
                className="ip-hold-box"
                style={{
                  marginBottom: 14,
                  border: `1px solid ${doc.emergencyPickResolved ? "#16a34a" : "#ef4444"}`,
                  background: doc.emergencyPickResolved
                    ? "rgba(22,163,74,0.08)"
                    : "rgba(239,68,68,0.08)",
                }}
              >
                {row("Checked By", doc.checkedBy && `👤 ${doc.checkedBy}`)}
                {groups.map((g, i) => (
                  <div key={i} style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, fontSize: "0.8rem" }}>
                      ⚠️ {g.reason || "Reason"}
                    </div>
                    {row("Wrong SKU / Description", g.skus.join(", ") || "—")}
                    {row("Quantity", g.qtys.join(", ") || "—")}
                  </div>
                ))}
                {doc.emergencyPickResolved &&
                  row("Re-picked By", doc.emergencyPickResolvedBy && `👤 ${doc.emergencyPickResolvedBy}`)}
              </div>
            </>
          );
        })()}

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: New Picking Error Alert (from Check Portal) ──────────────────────
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
function DocumentCard({
  doc, requestId, divisionLabel,
  onHandover, onStart, onHold, onEnd, onView, onEmergencyDone,
  onEdit, onDelete,
  cardRef, jumpHighlighted,
  // Role-based permission flags (from permissions.js → canUseButton).
  // These are computed once in the parent and passed down so this
  // component never has to know about the current user directly.
  canHandoverBtn, canStartBtn, canHoldBtn, canEndBtn, canEmergencyBtn,
  canEditBtn, canDeleteBtn,
}) {
  const sc = statusClass(doc.status);
  const jColor = jobTypeColor(doc.jobType);
  const isPending = sc === "pending";
  const isHandedOver = sc === "handedover";
  const isStarted = sc === "inprogress";
  const isOnHold = sc === "onhold";
  const isDone = sc === "completed";

  // Button availability = correct workflow state AND the logged-in role is
  // permitted to use that button (permissions.js).
  const canHandover = isPending && canHandoverBtn;
  const canStart = (isHandedOver || isOnHold) && canStartBtn;
  const canHold = isStarted && canHoldBtn;
  const canEnd = (isStarted || isOnHold) && canEndBtn;

  const hasCheckError =
    (doc.hasWrongMaterial || "").toUpperCase() === "YES" && !doc.emergencyPickResolved;

  const cardClassName = `ip-card status-${sc}${hasCheckError ? " ip-card-emergency" : ""}`;

  // Hard red border + tinted background on the card itself whenever there's
  // an unresolved picking error — set inline so it doesn't depend on a CSS
  // class being present/loaded.
  const cardBorderStyle = hasCheckError
    ? {
        border: "2px solid #ef4444",
        boxShadow: "0 0 0 1px rgba(239,68,68,0.35), 0 0 16px rgba(239,68,68,0.25)",
        background: "rgba(239,68,68,0.05)",
      }
    : undefined;

  const jumpStyle = jumpHighlighted
    ? { outline: "3px solid #facc15", outlineOffset: 2, transition: "outline-color 0.3s ease" }
    : undefined;

  return (
    <div ref={cardRef} className={cardClassName} style={{ ...cardBorderStyle, ...jumpStyle }}>
      {hasCheckError && (
        <div className="ip-emergency-banner">
          🚨 EMERGENCY PICK ERROR — Wrong Material Found at Check
        </div>
      )}
      <div className="ip-card-head">
        <div>
          <div className="ip-doc-no">{requestId || "—"}</div>
          <div className="ip-doc-number-sub">
            Doc No: {doc.printDocumentNo ? doc.printDocumentNo : "Not entered"}
          </div>
          <div style={{ color: jColor, fontWeight: 700, fontSize: "0.78rem", marginTop: 2 }}>
            {doc.jobType || "—"}
          </div>
          {divisionLabel && (
            <div className="ip-doc-division-sub">
               {divisionLabel}
            </div>
          )}
        </div>
        <span className={`ip-badge ${sc}`}>{statusLabel(doc.status)}</span>
      </div>

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
          <div className="ip-time-row"><span>Request Date</span><span>{formatDate(doc.requestDate)}</span></div>
          <div className="ip-time-row"><span>Request Time</span><span>{formatTime(doc.requestTime)}</span></div>
        </div>

        {!isPending && doc.handedOverBy && (
          <div className="ip-handover-box">
            <div className="ip-handover-row">
              <span>🚀 Handed Over By</span>
              <span>👤 {doc.handedOverBy}</span>
            </div>
          </div>
        )}

        {(isOnHold || doc.holdReason) && (
          <div className="ip-hold-box">
            <div className="ip-hold-row"><span>⏸ Hold Reason</span><span>{doc.holdReason || "—"}</span></div>
            <div className="ip-hold-row"><span>Held By</span><span>👤 {doc.heldBy || "—"}</span></div>
            <div className="ip-hold-row"><span>Held At</span><span>{formatDateTime(doc.holdTime)}</span></div>
          </div>
        )}

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

        {/* Picking error details — every reason logged by Check Portal shown
            as its own small group (Reason + SKU + Qty), right above the
            Emergency Pick Done button, font kept small to match the card's
            other stat text. */}
        {hasCheckError && (
          <div
            style={{
              marginTop: 15,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid #ef4444",
              borderLeft: "4px solid #ef4444",
              borderRadius: 10,
              padding: 12,
            }}
          >
            {parsePickingErrorGroups(doc).map((g, i) => (
              <div key={i} style={{ marginBottom: 8, fontSize: "0.72rem" }}>
                <div style={{ color: "#ef4444", fontWeight: 700, marginBottom: 4 }}>
                  ⚠️ {g.reason || "Reason"}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>SKU / Description</span>
                  <span>{g.skus.join(", ") || "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Quantity</span>
                  <span>{g.qtys.join(", ") || "—"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ip-card-foot">
        {isDone ? (
          <>
            {/* Edit/Delete are hidden entirely (not just disabled) unless
                the logged-in role has "edit"/"delete" in permissions.js.
                Picker's button list does not include them, so a Picker
                never sees these two on a completed card. */}
            {canEditBtn && (
              <button className="ip-btn ip-btn-edit" onClick={() => onEdit(doc)}>
                ✎ Edit
              </button>
            )}
            {canDeleteBtn && (
              <button className="ip-btn ip-btn-delete" onClick={() => onDelete(doc.id)}>
                🗑 Delete
              </button>
            )}
            <button className="ip-btn ip-btn-outline" onClick={() => onView(doc.id)}>
              👁 View
            </button>
          </>
        ) : (
          <>
            <button className="ip-btn ip-btn-handover-action" disabled={!canHandover} onClick={() => onHandover(doc.id)}>
              🚀 Handover
            </button>
            <button className="ip-btn ip-btn-start" disabled={!canStart} onClick={() => onStart(doc.id)}>
              {isOnHold ? "▶ Resume" : "▶ Start"}
            </button>
            <button className="ip-btn ip-btn-hold" disabled={!canHold} onClick={() => onHold(doc.id)}>
              ⏸ Hold
            </button>
            <button className="ip-btn ip-btn-end" disabled={!canEnd} onClick={() => onEnd(doc.id)}>
              ■ End
            </button>
            <button className="ip-btn ip-btn-outline" onClick={() => onView(doc.id)}>
              👁 View
            </button>
          </>
        )}
        {/* Emergency Pick Done button — always shown below the normal
            action row when there's an unresolved picking error AND the
            logged-in role is allowed to use it, hard red background +
            darker red border so it's unmistakable. Clicking it opens
            EmergencyPickDonePopup where the reasons/materials are shown
            again before picking who re-picked. */}
        {hasCheckError && canEmergencyBtn && (
          <button
            className="ip-btn ip-btn-emergency"
            style={{
              background: "#ef4444",
              color: "#ffffff",
              border: "2px solid #b91c1c",
              fontWeight: 700,
              width: "100%",
              marginTop: 8,
            }}
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
      <div className="ip-card-head" style={{ opacity: 0.6 }}>
        <div style={{ height: 40, background: "#e2e8f0", borderRadius: 4, width: "100%" }} />
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function IssuPikFormt() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Logged-in user (from sessionStorage via permissions.js) — read once on
  // mount. Used to compute which buttons this role is allowed to see/use.
  const currentUser = useMemo(() => getCurrentUser(), []);
  const buttonPerms = useMemo(() => ({
    handover: canUseButton(currentUser, "handover"),
    start: canUseButton(currentUser, "start"),
    hold: canUseButton(currentUser, "hold"),
    end: canUseButton(currentUser, "end"),
    emergency_done: canUseButton(currentUser, "emergency_done"),
    edit: canUseButton(currentUser, "edit"),
    delete: canUseButton(currentUser, "delete"),
  }), [currentUser]);

  // Divisions (Admin Master Data) — used only to label each card, exactly
  // like the Print Portal does with divisionNoToName.
  const [divisions, setDivisions] = useState([]);

  // Pickers shown in the currently open popup — scoped to that document's
  // Division (Admin Master Data, division-wise), fetched fresh each time a
  // popup opens — same pattern as the Print Portal's popupOperators.
  const [popupPickers, setPopupPickers] = useState([]);
  const [popupPickersLoading, setPopupPickersLoading] = useState(false);

  const [activePopup, setActivePopup] = useState(null); // "handover" | "hold" | "end" | "view" | "emergency" | "edit" | null
  const [activeId, setActiveId] = useState(null);

  // "New Picking Error" alert popup
  const [errorAlertDocs, setErrorAlertDocs] = useState([]);
  const [seenErrorIds, setSeenErrorIds] = useState(() => new Set());

  const cardRefs = useRef({});
  const [jumpHighlightId, setJumpHighlightId] = useState(null);

  const handleJumpToCard = (id) => {
    setErrorAlertDocs([]);
    const el = cardRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setJumpHighlightId(id);
    setTimeout(() => setJumpHighlightId(prev => (prev === id ? null : prev)), 2500);
  };

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(API_BASE);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      // Only show documents that already have a Print Document Number.
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

  // Division-wise pickers — only the names added under that specific
  // Division in Admin Master Setup → Picker. The backend's /pickers
  // endpoint returns ALL pickers, so we fetch them all and filter
  // client-side on divisionNo, exactly like the Print Portal does for
  // /print-operators.
  const fetchPickersForDivision = useCallback(async (divisionNo) => {
    if (!divisionNo) {
      setPopupPickers([]);
      return;
    }
    setPopupPickersLoading(true);
    try {
      const res = await fetch(`${SETUP_API}/pickers`);
      if (res.ok) {
        const data = await res.json();
        setPopupPickers(
          (data || [])
            .filter(p => {
              const pDivisionNo = p.divisionNo || (p.division && p.division.divisionNo) || "";
              return String(pDivisionNo) === String(divisionNo);
            })
            .map(p => p.pickerName || p.name || p.fullName)
            .filter(Boolean)
        );
      } else {
        setPopupPickers([]);
      }
    } catch (e) {
      console.warn("Failed to load pickers for division", e);
      setPopupPickers([]);
    } finally {
      setPopupPickersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments(false);
    fetchDivisions();
  }, [fetchDocuments, fetchDivisions]);

  useEffect(() => {
    const id = setInterval(() => fetchDocuments(true), AUTO_REFRESH);
    return () => clearInterval(id);
  }, [fetchDocuments]);

  const getDocById = useCallback((id) => documents.find(d => d.id === id), [documents]);

  const closePopup = () => {
    setActivePopup(null);
    setActiveId(null);
    setPopupPickers([]);
  };

  const assertOk = async (res, action) => {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${action} failed: Server error ${res.status}${body ? " — " + body : ""}`);
    }
  };

  // ── Open popups — each pulls the division-scoped picker list first ──
  // Every entry point below also re-checks the role permission before doing
  // any work, so even a manually-triggered call (e.g. from devtools) can't
  // open a popup the current user isn't allowed to use.
  const handleHandoverClick = async (id) => {
    if (!buttonPerms.handover) return;
    const doc = getDocById(id);
    setActiveId(id);
    setActivePopup("handover");
    await fetchPickersForDivision(doc?.divisionNo);
  };

  const handleHoldClick = async (id) => {
    if (!buttonPerms.hold) return;
    const doc = getDocById(id);
    setActiveId(id);
    setActivePopup("hold");
    await fetchPickersForDivision(doc?.divisionNo);
  };

  const handleEndClick = async (id) => {
    if (!buttonPerms.end) return;
    const doc = getDocById(id);
    setActiveId(id);
    setActivePopup("end");
    await fetchPickersForDivision(doc?.divisionNo);
  };

  const handleViewClick = (id) => { setActiveId(id); setActivePopup("view"); };

  const handleEmergencyClick = async (id) => {
    if (!buttonPerms.emergency_done) return;
    const doc = getDocById(id);
    setActiveId(id);
    setActivePopup("emergency");
    await fetchPickersForDivision(doc?.divisionNo);
  };

  // Edit — reopens pre-filled with the completed document's values, exactly
  // like the Print Portal's Edit action. Blocked for any role without the
  // "edit" permission (e.g. Picker).
  const handleEditClick = async (doc) => {
    if (!buttonPerms.edit) return;
    setActiveId(doc.id);
    setActivePopup("edit");
    await fetchPickersForDivision(doc?.divisionNo);
  };

  // ── Confirm handlers ──
  const handleHandoverConfirm = async (handedOverBy) => {
    const id = activeId; closePopup();
    try {
      const res = await fetch(`${API_BASE}/${id}/handover`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handedOverBy }),
      });
      await assertOk(res, "Handover");
      fetchDocuments(true);
    } catch (err) { alert(err.message); }
  };

  const handleStart = async (id) => {
    if (!buttonPerms.start) return;
    try {
      const res = await fetch(`${API_BASE}/${id}/start`, { method: "PUT" });
      await assertOk(res, "Start");
      fetchDocuments(true);
    } catch (err) { alert(err.message); }
  };

  const handleHoldConfirm = async (holdReason, heldBy) => {
    const id = activeId; closePopup();
    try {
      const res = await fetch(`${API_BASE}/${id}/hold`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdReason, heldBy }),
      });
      await assertOk(res, "Hold");
      fetchDocuments(true);
    } catch (err) { alert(err.message); }
  };

  const handleEndConfirm = async (pickedBy) => {
    const id = activeId; closePopup();
    try {
      const res = await fetch(`${API_BASE}/${id}/end`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickedBy }),
      });
      await assertOk(res, "End");
      fetchDocuments(true);
    } catch (err) { alert(err.message); }
  };

  const handleEmergencyConfirm = async (resolvedBy) => {
    const id = activeId; closePopup();
    try {
      const res = await fetch(`${API_BASE}/${id}/emergency-resolve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolvedBy }),
      });
      await assertOk(res, "Emergency Pick Done");
      fetchDocuments(true);
    } catch (err) { alert(err.message); }
  };

  const handleEditConfirm = async ({ heldBy, pickedBy }) => {
    const id = activeId; closePopup();
    try {
      const res = await fetch(`${API_BASE}/${id}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heldBy, pickedBy }),
      });
      await assertOk(res, "Edit");
      fetchDocuments(true);
    } catch (err) { alert(err.message); }
  };

  const handleDelete = async (id) => {
    if (!buttonPerms.delete) return;
    if (!window.confirm("Delete this document from the Pick Portal? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      await assertOk(res, "Delete");
      fetchDocuments(true);
    } catch (err) { alert(err.message); }
  };

  const requestIdMap = useMemo(() => computeRequestIds(documents), [documents]);

  const activeCheckErrorDocs = useMemo(
    () => documents.filter(d =>
      (d.hasWrongMaterial || "").toUpperCase() === "YES" && !d.emergencyPickResolved
    ),
    [documents]
  );

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

  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];

  const STATUS_FILTERS = [
    { value: "ALL", label: "All Status" },
    { value: "pending", label: "Pending" },
    { value: "handedover", label: "Handovered" },
    { value: "inprogress", label: "In Progress" },
    { value: "onhold", label: "On Hold" },
    { value: "completed", label: "Pick Done" },
  ];

  const visible = documents.filter(doc => {
    const q = search.toLowerCase();
    const matchSearch = !q || [
      String(doc.id), doc.jobwbs, doc.reservationNo, doc.enteredBy, doc.jobType,
    ].some(v => (v || "").toLowerCase().includes(q));

    const matchType = filterType === "ALL" || doc.jobType === filterType;
    const matchStatus = filterStatus === "ALL" || statusClass(doc.status) === filterStatus;

    return matchSearch && matchType && matchStatus;
  });

  const total = documents.length;
  const pending = documents.filter(d => statusClass(d.status) === "pending").length;
  const handedOver = documents.filter(d => statusClass(d.status) === "handedover").length;
  const inProg = documents.filter(d => statusClass(d.status) === "inprogress").length;
  const onHold = documents.filter(d => statusClass(d.status) === "onhold").length;
  const completed = documents.filter(d => statusClass(d.status) === "completed").length;

  // clicking a stat chip filters the grid by that status (Total clears it)
  const handleStatClick = (statusValue) => setFilterStatus(statusValue);

  const activeDoc = documents.find(d => d.id === activeId) || null;
  const activeDivisionLabel = activeDoc?.divisionNo
    ? `${activeDoc.divisionNo} — ${divisionNoToName[activeDoc.divisionNo] || ""}`
    : null;

  return (
    <div className="ip-page">
      {activePopup === "handover" && (
        <HandoverPopup onConfirm={handleHandoverConfirm} onCancel={closePopup} pickers={popupPickers} pickersLoading={popupPickersLoading} />
      )}
      {activePopup === "hold" && (
        <HoldPopup onConfirm={handleHoldConfirm} onCancel={closePopup} pickers={popupPickers} pickersLoading={popupPickersLoading} />
      )}
      {activePopup === "end" && (
        <PickedByPopup onConfirm={handleEndConfirm} onCancel={closePopup} pickers={popupPickers} pickersLoading={popupPickersLoading} />
      )}
      {activePopup === "view" && (
        <ViewDetailsPopup
          doc={activeDoc}
          requestId={activeId ? requestIdMap[activeId] : null}
          divisionLabel={activeDivisionLabel}
          onClose={closePopup}
        />
      )}
      {activePopup === "emergency" && (
        <EmergencyPickDonePopup
          doc={activeDoc}
          onConfirm={handleEmergencyConfirm}
          onCancel={closePopup}
          pickers={popupPickers}
          pickersLoading={popupPickersLoading}
        />
      )}
      {activePopup === "edit" && (
        <EditPopup
          doc={activeDoc}
          onConfirm={handleEditConfirm}
          onCancel={closePopup}
          pickers={popupPickers}
          pickersLoading={popupPickersLoading}
        />
      )}
      {errorAlertDocs.length > 0 && (
        <PickingErrorAlertPopup
          docs={errorAlertDocs}
          requestIdMap={requestIdMap}
          onJump={handleJumpToCard}
          onClose={() => setErrorAlertDocs([])}
        />
      )}

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
        <button className="ip-btn ip-btn-outline" style={{ flex: "unset", padding: "8px 18px" }} onClick={() => fetchDocuments(false)}>
          ↻ Refresh
        </button>
      </div>

      {activeCheckErrorDocs.length > 0 && (
        <div className="ip-error-banner">
          <div className="ip-error-banner-title">
            🚨 {activeCheckErrorDocs.length} Picking Error{activeCheckErrorDocs.length > 1 ? "s" : ""} Reported by Check Portal — needs Emergency Pick
          </div>
          <div className="ip-error-banner-chips">
            {activeCheckErrorDocs.map(d => (
              <span key={d.id} className="ip-error-chip">
                {requestIdMap[d.id] || "—"} · Doc No: {d.printDocumentNo || "—"}
                {d.pickingErrorReason ? ` · ${d.pickingErrorReason}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

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

      <div className="ip-stats">
        <button type="button" className={`ip-stat-chip blue ip-stat-chip-clickable ${filterStatus === "ALL" ? "active" : ""}`} onClick={() => handleStatClick("ALL")}>
          Total <strong>{total}</strong>
        </button>
        <button type="button" className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "pending" ? "active" : ""}`} onClick={() => handleStatClick("pending")}>
          <strong style={{ color: "#f59e0b" }}>{pending}</strong> Pending
        </button>
        <button type="button" className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "handedover" ? "active" : ""}`} onClick={() => handleStatClick("handedover")}>
          <strong style={{ color: "#3b82f6" }}>{handedOver}</strong> Handovered
        </button>
        <button type="button" className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "inprogress" ? "active" : ""}`} onClick={() => handleStatClick("inprogress")}>
          <strong style={{ color: "#1d4ed8" }}>{inProg}</strong> In Progress
        </button>
        <button type="button" className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "onhold" ? "active" : ""}`} onClick={() => handleStatClick("onhold")}>
          <strong style={{ color: "#c2410c" }}>{onHold}</strong> On Hold
        </button>
        <button type="button" className={`ip-stat-chip green ip-stat-chip-clickable ${filterStatus === "completed" ? "active" : ""}`} onClick={() => handleStatClick("completed")}>
          Done <strong>{completed}</strong>
        </button>
        <div className="ip-stat-chip">Showing <strong style={{ color: "#a78bfa" }}>{visible.length}</strong> of {total}</div>
      </div>

      {error && (
        <div className="ip-error-inline">
          ⚠ {error} — <button onClick={() => fetchDocuments(false)}>retry</button>
        </div>
      )}

      <div className="ip-grid">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : visible.length === 0 ? (
          <div className="ip-empty">No documents found{search ? ` for "${search}"` : ""}.</div>
        ) : (
          visible.map(doc => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              requestId={requestIdMap[doc.id]}
              divisionLabel={
                doc.divisionNo
                  ? `${doc.divisionNo} — ${divisionNoToName[doc.divisionNo] || ""}`
                  : null
              }
              onHandover={handleHandoverClick}
              onStart={handleStart}
              onHold={handleHoldClick}
              onEnd={handleEndClick}
              onView={handleViewClick}
              onEmergencyDone={handleEmergencyClick}
              onEdit={handleEditClick}
              onDelete={handleDelete}
              cardRef={el => { cardRefs.current[doc.id] = el; }}
              jumpHighlighted={jumpHighlightId === doc.id}
              canHandoverBtn={buttonPerms.handover}
              canStartBtn={buttonPerms.start}
              canHoldBtn={buttonPerms.hold}
              canEndBtn={buttonPerms.end}
              canEmergencyBtn={buttonPerms.emergency_done}
              canEditBtn={buttonPerms.edit}
              canDeleteBtn={buttonPerms.delete}
            />
          ))
        )}
      </div>
    </div>
  );
}
