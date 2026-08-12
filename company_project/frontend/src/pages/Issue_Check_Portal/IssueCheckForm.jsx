import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./IssueCheck.css";
import { formatSriLankaTime } from "../../utils/dateUtils";
import { getCurrentUser, canUseButton, logoutUser, hasAllDivisionAccess } from "../../config/permissions";

const API_BASE = "https://time-tracker-system-production.up.railway.app/api/check-portal";
const SETUP_API = "https://time-tracker-system-production.up.railway.app/api/admin-setup";

const PAGE_SIZE = 25;

const PICKING_ERROR_REASONS = [
  { key: "SHORTAGE", label: "Material Shortage", createsError: true },
  { key: "DIFFERENT", label: "Collected Different Material", createsError: true },
  { key: "EXCESS", label: "Material Excess", createsError: false },
];

const SKU_MAX_LENGTH = 80;

const STATUS_FILTERS = [
  { value: "ALL", label: "All Status" },
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "COMPLETED", label: "Check Done" },
];

const DATE_FILTER_OPTIONS = [
  { value: "TODAY", label: "Today" },
  { value: "ALL", label: "All" },
  { value: "CUSTOM", label: "Custom" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d) { return d || "—"; }
function formatTime(t) { return t ? String(t).substring(0, 5) : "—"; }

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function jobTypeColor(jt) {
  const map = {
    balance: "#a78bfa", domestic: "#34d399", cost_center: "#f59e0b",
    commercial: "#3b82f6", sales_order: "#f472b6",
  };
  return map[(jt || "").toLowerCase().replace(/\s+/g, "_")] || "#7c8db0";
}

// NOTE: same as Print/Pick — numbering restarts each page since the server
// now sends one page at a time.
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
  if (v.includes("hold")) return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("complete") || v.includes("done")) return "completed";
  return "pending";
}

function statusLabel(s) {
  const c = statusClass(s);
  return { pending: "Pending", inprogress: "In Progress", onhold: "On Hold", completed: "Check Done" }[c];
}

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

function getSriLankaTodayKey() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const colomboMs = utcMs + 5.5 * 60 * 60000;
  const colombo = new Date(colomboMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${colombo.getFullYear()}-${pad(colombo.getMonth() + 1)}-${pad(colombo.getDate())}`;
}

// ── Person Picker ─────────────────────────────────────────────────────────
function PersonPicker({ value, onChange, people, loading }) {
  return (
    <div className="ip-popup-options">
      {loading ? (
        <div className="ip-popup-empty">Loading checkers…</div>
      ) : !people || people.length === 0 ? (
        <div className="ip-popup-empty">
          No checkers found for this division in Master Setup.
        </div>
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

// ── Popup: Hold + Picking Error ─────────────────────────────────────────────
function HoldPopup({ people, peopleLoading, onConfirm, onCancel }) {
  const [heldBy, setHeldBy] = useState("");
  const [pickingErrorKeys, setPickingErrorKeys] = useState([]);
  const [materialsByReason, setMaterialsByReason] = useState({});

  const toggleReasonKey = (key) => {
    setPickingErrorKeys(prev => {
      if (key === "NONE") {
        return prev.includes("NONE") ? [] : ["NONE"];
      }
      const withoutNone = prev.filter(k => k !== "NONE");
      return withoutNone.includes(key)
        ? withoutNone.filter(k => k !== key)
        : [...withoutNone, key];
    });

    const reasonDef = PICKING_ERROR_REASONS.find(r => r.key === key);
    if (reasonDef && reasonDef.createsError) {
      setMaterialsByReason(prev => {
        const wasSelected = pickingErrorKeys.includes(key);
        const next = { ...prev };
        if (wasSelected) {
          delete next[key];
        } else {
          next[key] = next[key] || [{ sku: "", qty: "" }];
        }
        return next;
      });
    }
  };

  const selectedReasons = PICKING_ERROR_REASONS.filter(r => pickingErrorKeys.includes(r.key));
  const errorReasons = selectedReasons.filter(r => r.createsError);
  const needsDetails = errorReasons.length > 0;

  const addMaterialRow = (key) =>
    setMaterialsByReason(prev => ({
      ...prev,
      [key]: [...(prev[key] || [{ sku: "", qty: "" }]), { sku: "", qty: "" }],
    }));

  const removeMaterialRow = (key, idx) =>
    setMaterialsByReason(prev => ({
      ...prev,
      [key]: (prev[key] || []).filter((_, i) => i !== idx),
    }));

  const updateMaterialRow = (key, idx, field, value) =>
    setMaterialsByReason(prev => ({
      ...prev,
      [key]: (prev[key] || []).map((m, i) => (i === idx ? { ...m, [field]: value } : m)),
    }));

  const filledFor = (key) => (materialsByReason[key] || []).filter(m => m.sku.trim().length > 0 && m.qty.trim().length > 0);
  const invalidSkuFor = (key) => filledFor(key).filter(m => m.sku.trim().length > SKU_MAX_LENGTH);

  const allDetailsOk = errorReasons.every(
    r => filledFor(r.key).length > 0 && invalidSkuFor(r.key).length === 0
  );

  const canConfirm =
    !!heldBy &&
    pickingErrorKeys.length > 0 &&
    (!needsDetails || allDetailsOk);

  const handleConfirm = () => {
    const hasWrongMaterial = needsDetails ? "YES" : "NO";

    const reasonJoined = pickingErrorKeys.includes("NONE")
      ? ""
      : selectedReasons.map(r => r.label).join(", ");

    const skuJoined = needsDetails
      ? errorReasons
          .map(r => `${r.label}::${filledFor(r.key).map(m => m.sku.trim()).join(",")}`)
          .join("||")
      : "";
    const qtyJoined = needsDetails
      ? errorReasons
          .map(r => `${r.label}::${filledFor(r.key).map(m => m.qty.trim()).join(",")}`)
          .join("||")
      : "";

    onConfirm(heldBy, hasWrongMaterial, skuJoined, qtyJoined, reasonJoined);
  };

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>⏸ Hold Check</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select whether there's a picking error (you can pick more than one), and who is holding this</p>

        <span className="ip-popup-label">Picking Error?</span>
        <div className="ip-popup-options" style={{ marginBottom: 16 }}>
          {PICKING_ERROR_REASONS.map(r => (
            <button
              key={r.key}
              className={`ip-popup-option ${pickingErrorKeys.includes(r.key) ? "selected" : ""}`}
              onClick={() => toggleReasonKey(r.key)}
            >
              {pickingErrorKeys.includes(r.key) ? "☑ " : "☐ "}
              {r.createsError ? "⚠️ " : "ℹ️ "}{r.label}
            </button>
          ))}
          <button
            className={`ip-popup-option ${pickingErrorKeys.includes("NONE") ? "selected" : ""}`}
            onClick={() => toggleReasonKey("NONE")}
          >
            ✅ No Picking Error
          </button>
        </div>

        {errorReasons.map(r => {
          const rows = materialsByReason[r.key] || [{ sku: "", qty: "" }];
          return (
            <div key={r.key} style={{ marginBottom: 16 }}>
              <span className="ip-popup-label">⚠️ {r.label} — Wrong Material(s)</span>

              {rows.map((m, idx) => {
                const skuTrimmed = m.sku.trim();
                const skuTooLong = skuTrimmed.length > SKU_MAX_LENGTH;
                return (
                  <div key={idx} style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        className="ip-popup-text-input"
                        type="text"
                        placeholder="SKU / Description"
                        value={m.sku}
                        maxLength={SKU_MAX_LENGTH}
                        onChange={e => updateMaterialRow(r.key, idx, "sku", e.target.value)}
                        style={{ flex: 2, borderColor: skuTooLong ? "#ef4444" : undefined }}
                      />
                      <input
                        className="ip-popup-text-input"
                        type="text"
                        placeholder="Quantity"
                        value={m.qty}
                        onChange={e => updateMaterialRow(r.key, idx, "qty", e.target.value)}
                        style={{ flex: 1 }}
                      />
                      {rows.length > 1 && (
                        <button
                          className="ip-btn ip-btn-outline"
                          style={{ padding: "6px 10px", flex: "unset" }}
                          onClick={() => removeMaterialRow(r.key, idx)}
                          aria-label="Remove row"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    {skuTooLong && (
                      <div style={{ color: "#ef4444", fontSize: "0.72rem", marginTop: 4 }}>
                        SKU / Description must be at most {SKU_MAX_LENGTH} characters ({skuTrimmed.length}/{SKU_MAX_LENGTH})
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                className="ip-btn ip-btn-outline"
                style={{ marginTop: 10, padding: "6px 14px", flex: "unset" }}
                onClick={() => addMaterialRow(r.key)}
              >
                + Add Material for {r.label}
              </button>
            </div>
          );
        })}

        <span className="ip-popup-label">Held By</span>
        <PersonPicker value={heldBy} onChange={setHeldBy} people={people} loading={peopleLoading} />

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

// ── Popup: Check Done ────────────────────────────────────────────────────────
function CheckDonePopup({ people, peopleLoading, onConfirm, onCancel }) {
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

        <PersonPicker value={checkedBy} onChange={setCheckedBy} people={people} loading={peopleLoading} />

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

// ── Popup: Edit ───────────────────────────────────────────────────────────
function EditPopup({ doc, people, peopleLoading, onConfirm, onCancel }) {
  const [heldBy, setHeldBy] = useState(doc?.checkHeldBy || "");
  const [checkedBy, setCheckedBy] = useState(doc?.checkedBy || "");

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>✏ Edit Document</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Only Held By and Checked By can be changed here</p>

        <span className="ip-popup-label">Held By</span>
        <PersonPicker value={heldBy} onChange={setHeldBy} people={people} loading={peopleLoading} />

        <span className="ip-popup-label" style={{ marginTop: 14, display: "block" }}>
          Checked By
        </span>
        <PersonPicker value={checkedBy} onChange={setCheckedBy} people={people} loading={peopleLoading} />

        <div className="ip-popup-foot" style={{ marginTop: 18 }}>
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            onClick={() => onConfirm({ heldBy, checkedBy })}
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
          {row("Requested By", doc.requestedBy)}
          {row("Entered By", doc.enteredBy)}
          {row("Job Type", doc.jobType)}
          {row("Division", divisionLabel || "—")}
          {row("Request Date", formatDate(doc.requestDate))}
          {row("Request Time", formatTime(doc.requestTime))}
        </div>

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Print Portal
        </div>
        <div className="ip-hold-box" style={{ marginBottom: 14 }}>
          {row("Handed Over By", doc.printHandedOverBy && `👤 ${doc.printHandedOverBy}`)}
          {row("Document Number", doc.printDocumentNo)}
          {row("Vehicle Number", doc.vehicleNo)}
          {row("Print Hold Reason", doc.printHoldReason)}
          {row("Print Held By", doc.printHeldBy && `👤 ${doc.printHeldBy}`)}
          {row("Print Held At", formatSriLankaTime(doc.printHoldTime))}
          {row("Printed By", doc.printedBy && `👤 ${doc.printedBy}`)}
          {row("Print Duration", `⏱ ${formatDuration(doc.printDurationSeconds)}`)}
        </div>

        <div style={{ marginBottom: 6, fontSize: "0.78rem", color: "#7c8db0", fontWeight: 600 }}>
          Pick Portal
        </div>
        <div className="ip-hold-box" style={{ marginBottom: 14 }}>
          {row("Pick Hold Reason", doc.pickHoldReason)}
          {row("Pick Held By", doc.pickHeldBy && `👤 ${doc.pickHeldBy}`)}
          {row("Pick Held At", formatSriLankaTime(doc.pickHoldTime))}
          {row("Picked By", doc.pickedBy && `👤 ${doc.pickedBy}`)}
          {row("Pick Duration", `⏱ ${formatDuration(doc.pickDurationSeconds ?? doc.durationSeconds)}`)}
        </div>

        {doc.pickingErrorReason && !isFlagged && (
          <>
            <div style={{ marginBottom: 6, fontSize: "0.78rem", fontWeight: 700, color: "#7c8db0" }}>
              ℹ️ Picking Note
            </div>
            <div className="ip-hold-box" style={{ marginBottom: 14 }}>
              {row("Note", doc.pickingErrorReason)}
            </div>
          </>
        )}

        {isFlagged && (() => {
          const groups = parsePickingErrorGroups(doc);
          return (
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
                {groups.map((g, i) => (
                  <div key={i} style={{ marginBottom: i === groups.length - 1 ? 0 : 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, fontSize: "0.8rem" }}>
                      ⚠️ {g.reason || "Reason"}
                    </div>
                    {row("SKU / Description", g.skus.join(", ") || "—")}
                    {row("Quantity", g.qtys.join(", ") || "—")}
                  </div>
                ))}
                {row("Re-picked By", doc.emergencyPickResolvedBy && `👤 ${doc.emergencyPickResolvedBy}`)}
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

// ── Popup: New Emergency Pick Done Alert ────────────────────────────────────
function ResolvedPickAlertPopup({ docs, requestIdMap, onJump, onClose }) {
  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>✅ Emergency Pick{docs.length > 1 ? "s" : ""} Done</span>
          <button className="ip-popup-close" onClick={onClose}>✕</button>
        </div>
        <p className="ip-popup-sub">
          Pick Portal re-picked {docs.length} document{docs.length > 1 ? "s" : ""} — click one to jump to it
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {docs.map(d => (
            <button
              key={d.id}
              onClick={() => onJump(d.id)}
              style={{
                textAlign: "left",
                background: "rgba(52,211,153,0.1)",
                border: "1px solid #34d399",
                borderRadius: 8,
                padding: "10px 12px",
                cursor: "pointer",
                color: "#fff",
              }}
            >
              <div style={{ fontWeight: 700, color: "#34d399", marginBottom: 4 }}>
                {requestIdMap[d.id] || "—"} · Doc No: {d.printDocumentNo || "—"}
              </div>
              <div style={{ fontSize: "0.8rem", color: "#86efac" }}>
                {d.pickingErrorReason ? `${d.pickingErrorReason} · ` : ""}
                Re-picked by {d.emergencyPickResolvedBy || "—"}
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
  onStart, onHold, onEnd, onView, onEdit, onDelete,
  cardRef, jumpHighlighted,
  canStartBtn, canHoldBtn, canEndBtn, canEditBtn, canDeleteBtn,
}) {
  const sc        = statusClass(doc.checkStatus);
  const jColor    = jobTypeColor(doc.jobType);
  const isPending = sc === "pending";
  const isStarted = sc === "inprogress";
  const isOnHold  = sc === "onhold";
  const isDone    = sc === "completed";

  const isFlagged = (doc.hasWrongMaterial || "").toUpperCase() === "YES";
  const hasUnresolvedError = isFlagged && !doc.emergencyPickResolved && !isDone;
  const hasResolvedError = isFlagged && doc.emergencyPickResolved && !isDone;

  const canStart = (isPending || isOnHold) && canStartBtn;
  const canHold = isStarted && canHoldBtn;
  const canEnd = isStarted && canEndBtn;

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

  const jumpStyle = jumpHighlighted
    ? { outline: "3px solid #facc15", outlineOffset: 2, transition: "outline-color 0.3s ease" }
    : undefined;

  return (
    <div ref={cardRef} className={cardClassName} style={{ ...cardStyle, ...jumpStyle }}>
      {hasUnresolvedError && (
        <div style={{
          background: "#ef4444", color: "#fff", fontWeight: 700, fontSize: "0.78rem",
          padding: "6px 12px", borderRadius: 6, marginBottom: 10,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          🚨 PICKING ERROR{doc.pickingErrorReason ? ` (${doc.pickingErrorReason})` : ""} — Emergency Pick Required
        </div>
      )}
      {hasResolvedError && (
        <div style={{
          background: "#34d399", color: "#06281c", fontWeight: 700, fontSize: "0.78rem",
          padding: "6px 12px", borderRadius: 6, marginBottom: 10,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          ✅ EMERGENCY PICK DONE — Re-picked, ready to continue check
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
        <span className={`ip-badge ${hasUnresolvedError ? "onhold" : hasResolvedError ? "completed" : sc}`}>
          {hasUnresolvedError
            ? "🚨 Picking Error Pending"
            : hasResolvedError
            ? "✅ Emergency Pick Done"
            : statusLabel(doc.checkStatus)}
        </span>
      </div>

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

        {(isOnHold || doc.checkHeldBy) && (
          <div className="ip-hold-box">
            <div className="ip-hold-row">
              <span>Held By</span>
              <span>👤 {doc.checkHeldBy || "—"}</span>
            </div>
            <div className="ip-hold-row">
              <span>Held At</span>
              <span>{formatSriLankaTime(doc.checkHoldTime)}</span>
            </div>
            {doc.checkResumeTime && (
              <div className="ip-hold-row">
                <span>Resumed At</span>
                <span>{formatSriLankaTime(doc.checkResumeTime)}</span>
              </div>
            )}
          </div>
        )}

        {isFlagged && (
          <div className="ip-wrong-material-box">
            {parsePickingErrorGroups(doc).map((g, i) => (
              <div key={i} style={{ marginBottom: 6, fontSize: "0.72rem" }}>
                <div className="ip-wrong-material-row" style={{ fontWeight: 700 }}>
                  <span>{hasResolvedError ? "✅ Emergency Pick Done" : "⚠️ " + (g.reason || "Wrong Material")}</span>
                </div>
                <div className="ip-wrong-material-row">
                  <span>SKU / Description</span>
                  <span>{g.skus.join(", ") || "—"}</span>
                </div>
                <div className="ip-wrong-material-row">
                  <span>Quantity</span>
                  <span>{g.qtys.join(", ") || "—"}</span>
                </div>
              </div>
            ))}
            {hasResolvedError && (
              <div className="ip-wrong-material-row">
                <span>Re-picked By</span>
                <span>👤 {doc.emergencyPickResolvedBy || "—"}</span>
              </div>
            )}
          </div>
        )}

        {!isFlagged && doc.pickingErrorReason && (
          <div className="ip-hold-box">
            <div className="ip-hold-row">
              <span>ℹ️ Picking Note</span>
              <span>{doc.pickingErrorReason}</span>
            </div>
          </div>
        )}

        {isDone && (
          <>
            {!isFlagged && !doc.pickingErrorReason && (
              <div className="ip-no-issue-box">✅ No material issues</div>
            )}

            <div className="ip-print-done-box">
              <div className="ip-print-done-row">
                <span>Started At</span>
                <span>{formatSriLankaTime(doc.checkStartTime)}</span>
              </div>
              <div className="ip-print-done-row">
                <span>Ended At</span>
                <span>{formatSriLankaTime(doc.checkEndTime)}</span>
              </div>
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

      <div className="ip-card-foot">
        {isDone ? (
          <>
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
  const navigate = useNavigate();

  const [documents,    setDocuments]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [search,       setSearch]       = useState("");
  const [filterType,   setFilterType]   = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const [refreshing,   setRefreshing]   = useState(false);

  // ── Pagination — server returns PAGE_SIZE (25) rows at a time ─────────
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);

  const [dateFilterMode, setDateFilterMode] = useState("TODAY");
  const [fromDate,     setFromDate]     = useState("");
  const [toDate,       setToDate]       = useState("");

  // ── Stats (Total / Pending / In Progress / On Hold / Check Done / Wrong) ──
  const [stats, setStats] = useState({
    total: 0, pending: 0, inProgress: 0, onHold: 0, completed: 0, wrongMaterial: 0,
  });

  const currentUser = useMemo(() => getCurrentUser(), []);
  const buttonPerms = useMemo(() => ({
    start: canUseButton(currentUser, "start"),
    hold: canUseButton(currentUser, "hold"),
    end: canUseButton(currentUser, "end"),
    edit: canUseButton(currentUser, "edit"),
    delete: canUseButton(currentUser, "delete"),
  }), [currentUser]);

  const isAdminRole =
    currentUser?.staffName === "Admin" ||
    currentUser?.staffName === "System Administrator";

  const handleLogout = () => {
    logoutUser();
    navigate("/login", { replace: true });
  };

  // Divisions this user is scoped to — sent to the backend, same pattern
  // as Print/Pick Portal.
  const hasFullDivisionAccess = useMemo(() => hasAllDivisionAccess(currentUser), [currentUser]);
  const divisionsParam = useMemo(() => {
    if (hasFullDivisionAccess) return undefined;
    if (Array.isArray(currentUser?.divisions) && currentUser.divisions.length > 0) {
      return currentUser.divisions.join(",");
    }
    return undefined;
  }, [hasFullDivisionAccess, currentUser]);

  const [divisions, setDivisions] = useState([]);

  const [popupOperators,        setPopupOperators]        = useState([]);
  const [popupOperatorsLoading, setPopupOperatorsLoading]  = useState(false);

  const [activePopup,  setActivePopup]  = useState(null);
  const [activeId,     setActiveId]     = useState(null);

  const [resolvedAlertDocs, setResolvedAlertDocs] = useState([]);
  const [seenResolvedIds,   setSeenResolvedIds]   = useState(() => new Set());

  const cardRefs = useRef({});
  const [jumpHighlightId, setJumpHighlightId] = useState(null);

  const handleJumpToCard = (id) => {
    setResolvedAlertDocs([]);
    const el = cardRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setJumpHighlightId(id);
    setTimeout(() => setJumpHighlightId(prev => (prev === id ? null : prev)), 2500);
  };

  const activeDateParam =
    dateFilterMode === "TODAY" ? getSriLankaTodayKey() :
    dateFilterMode === "CUSTOM" && fromDate ? fromDate :
    undefined;

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
      if (filterType !== "ALL") params.set("jobType", filterType);
      if (filterStatus !== "ALL") params.set("status", filterStatus);
      if (search) params.set("search", search);
      if (activeDateParam) params.set("date", activeDateParam);
      if (divisionsParam) params.set("divisions", divisionsParam);

      const res = await fetch(`${API_BASE}/paged?${params.toString()}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setDocuments(data.content || []);
      setTotalPages(data.totalPages || 0);
      setTotalElements(data.totalElements || 0);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, filterType, filterStatus, search, activeDateParam, divisionsParam]);

  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (activeDateParam) params.set("date", activeDateParam);
      if (divisionsParam) params.set("divisions", divisionsParam);

      const res = await fetch(`${API_BASE}/stats?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setStats({
          total: data.total ?? 0,
          pending: data.pending ?? 0,
          inProgress: data.inProgress ?? 0,
          onHold: data.onHold ?? 0,
          completed: data.completed ?? 0,
          wrongMaterial: data.wrongMaterial ?? 0,
        });
      }
    } catch (e) {
      console.warn("Failed to load stats", e);
    }
  }, [activeDateParam, divisionsParam]);

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

  const fetchOperatorsForDivision = useCallback(async (divisionNo) => {
    if (!divisionNo) {
      setPopupOperators([]);
      return;
    }
    setPopupOperatorsLoading(true);
    try {
      const res = await fetch(`${SETUP_API}/check-operators`);
      if (res.ok) {
        const data = await res.json();
        setPopupOperators(
          (data || [])
            .filter(p => {
              const pDivisionNo = p.divisionNo || (p.division && p.division.divisionNo) || "";
              return String(pDivisionNo) === String(divisionNo);
            })
            .map(p => p.operatorName)
            .filter(Boolean)
        );
      } else {
        setPopupOperators([]);
      }
    } catch (e) {
      console.warn("Failed to load checkers for division", e);
      setPopupOperators([]);
    } finally {
      setPopupOperatorsLoading(false);
    }
  }, []);

  // Reset to page 0 whenever a filter changes.
  useEffect(() => {
    setPage(0);
  }, [filterType, filterStatus, search, dateFilterMode, fromDate, toDate]);

  useEffect(() => {
    fetchDocuments(false);
  }, [fetchDocuments]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchDivisions();
  }, [fetchDivisions]);

  const getDocById = useCallback((id) => documents.find(d => d.id === id), [documents]);

  const refreshAll = (silent) => {
    fetchDocuments(silent);
    fetchStats();
  };

  const handleStart = async (id) => {
    if (!buttonPerms.start) return;
    try {
      await fetch(`${API_BASE}/${id}/start`, { method: "PUT" });
      refreshAll(true);
    } catch (err) {
      alert("Start failed: " + err.message);
    }
  };

  const handleHoldClick = async (id) => {
    if (!buttonPerms.hold) return;
    const doc = getDocById(id);
    setActiveId(id);
    setActivePopup("hold");
    await fetchOperatorsForDivision(doc?.divisionNo);
  };

  const handleEndClick = async (id) => {
    if (!buttonPerms.end) return;
    const doc = getDocById(id);
    setActiveId(id);
    setActivePopup("end");
    await fetchOperatorsForDivision(doc?.divisionNo);
  };

  const handleViewClick = (id) => { setActiveId(id); setActivePopup("view"); };

  const handleEditClick = async (doc) => {
    if (!buttonPerms.edit) return;
    setActiveId(doc.id);
    setActivePopup("edit");
    await fetchOperatorsForDivision(doc?.divisionNo);
  };

  const closePopup = () => {
    setActivePopup(null);
    setActiveId(null);
    setPopupOperators([]);
  };

  const assertOk = async (res, action) => {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${action} failed: Server error ${res.status}${body ? " — " + body : ""}`);
    }
  };

  const handleHoldConfirm = async (heldBy, hasWrongMaterial, wrongMaterialSku, wrongMaterialQty, pickingErrorReason) => {
    const id = activeId;
    closePopup();
    try {
      const res = await fetch(`${API_BASE}/${id}/hold`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heldBy, hasWrongMaterial, wrongMaterialSku, wrongMaterialQty, pickingErrorReason }),
      });
      await assertOk(res, "Hold");
      refreshAll(true);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCheckDoneConfirm = async (checkedBy) => {
    const id = activeId;
    closePopup();
    try {
      const res = await fetch(`${API_BASE}/${id}/end`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkedBy }),
      });
      await assertOk(res, "Check Done");
      refreshAll(true);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEditConfirm = async ({ heldBy, checkedBy }) => {
    const id = activeId;
    closePopup();
    try {
      const res = await fetch(`${API_BASE}/${id}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heldBy, checkedBy }),
      });
      await assertOk(res, "Edit");
      refreshAll(true);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!buttonPerms.delete) return;
    if (!window.confirm("Delete this document from the Check Portal? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      await assertOk(res, "Delete");
      refreshAll(true);
    } catch (err) {
      alert(err.message);
    }
  };

  const requestIdMap = useMemo(() => computeRequestIds(documents), [documents]);

  // NOTE: only scans the current page, same caveat as Print/Pick Portal.
  const activeErrorDocs = useMemo(
    () => documents.filter(d => {
      const isFlagged = (d.hasWrongMaterial || "").toUpperCase() === "YES";
      return isFlagged && !d.emergencyPickResolved && statusClass(d.checkStatus) !== "completed";
    }),
    [documents]
  );

  const resolvedErrorDocs = useMemo(
    () => documents.filter(d => {
      const isFlagged = (d.hasWrongMaterial || "").toUpperCase() === "YES";
      return isFlagged && d.emergencyPickResolved && statusClass(d.checkStatus) !== "completed";
    }),
    [documents]
  );

  useEffect(() => {
    setSeenResolvedIds(prevSeen => {
      const newOnes = resolvedErrorDocs.filter(d => !prevSeen.has(d.id));
      if (newOnes.length > 0) {
        setResolvedAlertDocs(prevAlert => {
          const existingIds = new Set(prevAlert.map(d => d.id));
          return [...prevAlert, ...newOnes.filter(d => !existingIds.has(d.id))];
        });
      }
      return new Set(resolvedErrorDocs.map(d => d.id));
    });
  }, [resolvedErrorDocs]);

  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];

  const handleStatClick = (statusValue) => setFilterStatus(statusValue);

  const viewingDoc = documents.find(d => d.id === activeId) || null;
  const viewingDivisionLabel = viewingDoc?.divisionNo
    ? `${viewingDoc.divisionNo} — ${divisionNoToName[viewingDoc.divisionNo] || ""}`
    : null;

  return (
    <div className="ip-page">

      {activePopup === "hold" && (
        <HoldPopup
          people={popupOperators}
          peopleLoading={popupOperatorsLoading}
          onConfirm={handleHoldConfirm}
          onCancel={closePopup}
        />
      )}
      {activePopup === "end" && (
        <CheckDonePopup
          people={popupOperators}
          peopleLoading={popupOperatorsLoading}
          onConfirm={handleCheckDoneConfirm}
          onCancel={closePopup}
        />
      )}
      {activePopup === "view" && (
        <ViewDetailsPopup
          doc={viewingDoc}
          requestId={activeId ? requestIdMap[activeId] : null}
          divisionLabel={viewingDivisionLabel}
          onClose={closePopup}
        />
      )}
      {activePopup === "edit" && (
        <EditPopup
          doc={viewingDoc}
          people={popupOperators}
          peopleLoading={popupOperatorsLoading}
          onConfirm={handleEditConfirm}
          onCancel={closePopup}
        />
      )}
      {resolvedAlertDocs.length > 0 && (
        <ResolvedPickAlertPopup
          docs={resolvedAlertDocs}
          requestIdMap={requestIdMap}
          onJump={handleJumpToCard}
          onClose={() => setResolvedAlertDocs([])}
        />
      )}

      <div className="ip-header">
        <div className="ip-header-left">
          <h1>LOGITRACK-WAREHOUSE TIME EFFICENCY TRACKER SYSTEM</h1>
          <h1>  Check Portal</h1>
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
            onClick={() => refreshAll(false)}
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

      {activeErrorDocs.length > 0 && (
        <div style={{
          background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", borderRadius: 8,
          padding: "12px 16px", marginBottom: 18, display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ color: "#ef4444", fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
            🚨 {activeErrorDocs.length} Picking Error{activeErrorDocs.length > 1 ? "s" : ""} Pending — waiting on Pick Portal
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {activeErrorDocs.map(d => (
              <span
                key={d.id}
                style={{
                  background: "#ef4444", color: "#fff", fontWeight: 600, fontSize: "0.78rem",
                  padding: "4px 10px", borderRadius: 6,
                }}
              >
                {requestIdMap[d.id] || "—"} · Doc No: {d.printDocumentNo || "—"}
              </span>
            ))}
          </div>
        </div>
      )}

      {resolvedErrorDocs.length > 0 && (
        <div style={{
          background: "rgba(52,211,153,0.15)", border: "1px solid #34d399", borderRadius: 8,
          padding: "12px 16px", marginBottom: 18, display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ color: "#34d399", fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 8 }}>
            ✅ {resolvedErrorDocs.length} Emergency Pick{resolvedErrorDocs.length > 1 ? "s" : ""} Done — re-picked, ready to continue check
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {resolvedErrorDocs.map(d => (
              <button
                key={d.id}
                onClick={() => handleJumpToCard(d.id)}
                style={{
                  background: "#34d399", color: "#06281c", fontWeight: 600, fontSize: "0.78rem",
                  padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                }}
              >
                {requestIdMap[d.id] || "—"} · Doc No: {d.printDocumentNo || "—"} · Emergency Pick Done
              </button>
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
            placeholder="Search by Requested By, WBS, Reservation..."
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

      <div className="ip-stats">
        <button
          type="button"
          className={`ip-stat-chip blue ip-stat-chip-clickable ${filterStatus === "ALL" ? "active" : ""}`}
          onClick={() => handleStatClick("ALL")}
        >
          Total <strong>{stats.total}</strong>
        </button>
        <button
          type="button"
          className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "PENDING" ? "active" : ""}`}
          onClick={() => handleStatClick("PENDING")}
        >
          <strong style={{color:"#f59e0b"}}>{stats.pending}</strong> Pending
          {stats.wrongMaterial > 0 && (
            <span style={{ marginLeft: 6, color: "#ef4444", fontWeight: 700, fontSize: "0.75rem" }}>
              ⚠️ {stats.wrongMaterial}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "IN_PROGRESS" ? "active" : ""}`}
          onClick={() => handleStatClick("IN_PROGRESS")}
        >
          <strong style={{color:"#3b82f6"}}>{stats.inProgress}</strong> In Progress
        </button>
        <button
          type="button"
          className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "ON_HOLD" ? "active" : ""}`}
          onClick={() => handleStatClick("ON_HOLD")}
        >
          <strong style={{color:"#fb923c"}}>{stats.onHold}</strong> On Hold
        </button>
        <button
          type="button"
          className={`ip-stat-chip green ip-stat-chip-clickable ${filterStatus === "COMPLETED" ? "active" : ""}`}
          onClick={() => handleStatClick("COMPLETED")}
        >
          Check Done <strong>{stats.completed}</strong>
        </button>
      </div>

      {error && (
        <div style={{
          background:"rgba(239,68,68,0.12)", border:"1px solid #ef4444",
          borderRadius:8, padding:"12px 16px", color:"#fca5a5",
          marginBottom:18, fontSize:"0.85rem",
        }}>
          ⚠ {error} —{" "}
          <button onClick={() => refreshAll(false)}
            style={{background:"none",border:"none",color:"#60a5fa",cursor:"pointer",textDecoration:"underline"}}>
            retry
          </button>
        </div>
      )}

      <div className="ip-grid">
        {loading ? (
          [1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)
        ) : documents.length === 0 ? (
          <div className="ip-empty">
            <div className="ip-empty-icon">📭</div>
            <p>No documents found{search ? ` for "${search}"` : ""}.</p>
          </div>
        ) : (
          documents.map(doc => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              requestId={requestIdMap[doc.id]}
              divisionLabel={
                doc.divisionNo
                  ? `${doc.divisionNo} — ${divisionNoToName[doc.divisionNo] || ""}`
                  : null
              }
              onStart={handleStart}
              onHold={handleHoldClick}
              onEnd={handleEndClick}
              onView={handleViewClick}
              onEdit={handleEditClick}
              onDelete={handleDelete}
              cardRef={el => { cardRefs.current[doc.id] = el; }}
              jumpHighlighted={jumpHighlightId === doc.id}
              canStartBtn={buttonPerms.start}
              canHoldBtn={buttonPerms.hold}
              canEndBtn={buttonPerms.end}
              canEditBtn={buttonPerms.edit}
              canDeleteBtn={buttonPerms.delete}
            />
          ))
        )}
      </div>

      {/* Pagination — 25 documents per page, same as Print/Pick Portal */}
      {!loading && documents.length > 0 && (
        <div className="ip-toolbar" style={{ justifyContent: "center", marginTop: 12 }}>
          <button
            type="button"
            className="ip-btn ip-btn-outline"
            style={{ flex: "unset", padding: "8px 18px" }}
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(p - 1, 0))}
          >
            ‹ Prev
          </button>
          <span style={{ padding: "0 14px", fontSize: "0.85rem", color: "#6c8bb3" }}>
            Page {page + 1} of {Math.max(totalPages, 1)} · {totalElements} total
          </span>
          <button
            type="button"
            className="ip-btn ip-btn-outline"
            style={{ flex: "unset", padding: "8px 18px" }}
            disabled={page + 1 >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}