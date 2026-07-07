import { useState, useEffect, useCallback } from "react";
import "./IssueDelivery.css";

const API_BASE = "http://localhost:8080/api/delivery-portal";
const AUTO_REFRESH = 10000;

const PEOPLE_OPTIONS = ["Shanuka", "Chameera", "Randunu"];

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
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const OVERDUE_DAYS = 30;

// NOTE: assumes the backend sends a print timestamp as `printedDate` (or
// `printDate`). If your Issue entity uses a different field name, change
// PRINT_DATE_FIELDS below to match — the first present field wins.
const PRINT_DATE_FIELDS = ["printedDate", "printDate", "printDateTime"];

function getPrintDateTime(doc) {
  for (const f of PRINT_DATE_FIELDS) {
    if (doc[f]) return doc[f];
  }
  // fallback: combine requestDate + requestTime if no explicit print timestamp exists
  if (doc.requestDate) {
    return `${doc.requestDate}T${doc.requestTime || "00:00:00"}`;
  }
  return null;
}

function daysPending(doc) {
  const raw = getPrintDateTime(doc);
  if (!raw) return null;
  const printed = new Date(raw);
  if (isNaN(printed.getTime())) return null;
  const now = new Date();
  const diffMs = now.getTime() - printed.getTime();
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
        <PersonPicker value={heldBy} onChange={setHeldBy} />

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

function CancelPopup({ onConfirm, onCancel }) {
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
        <PersonPicker value={cancelledBy} onChange={setCancelledBy} />

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

function DeliveryDonePopup({ onConfirm, onCancel }) {
  const [deliveredBy, setDeliveredBy] = useState("");
  const [vehicleNo, setVehicleNo]     = useState("");

  const canConfirm = !!deliveredBy && vehicleNo.trim().length > 0;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>🚚 Delivery Done</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select who delivered this document</p>

        <span className="ip-popup-label">Delivered By</span>
        <div style={{ marginBottom: 16 }}>
          <PersonPicker value={deliveredBy} onChange={setDeliveredBy} />
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
            ✅ Delivery Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: View full document details ───────────────────────────────────────

function ViewPopup({ doc, onClose }) {
  const sc = statusClass(doc.deliveryStatus);

  return (
    <div className="ip-popup-overlay" onClick={onClose}>
      <div className="ip-popup ip-view-popup" onClick={e => e.stopPropagation()}>
        <div className="ip-popup-head">
          <span>📄 {doc.printDocumentNo ? doc.printDocumentNo : `Doc #${doc.id}`}</span>
          <button className="ip-popup-close" onClick={onClose}>✕</button>
        </div>
        <p className="ip-popup-sub">Full document details</p>

        <div className="ip-view-grid">
          <div className="ip-detail-row">
            <span className="ip-detail-label">Job Type</span>
            <span className="ip-detail-value" style={{ color: jobTypeColor(doc.jobType), fontWeight: 700 }}>
              {doc.jobType || "—"}
            </span>
          </div>
          <div className="ip-detail-row">
            <span className="ip-detail-label">Reservation No</span>
            <span className="ip-detail-value">{doc.reservationNo || "—"}</span>
          </div>
          <div className="ip-detail-row">
            <span className="ip-detail-label">Entered By</span>
            <span className="ip-detail-value">{doc.enteredBy || "—"}</span>
          </div>
        </div>

        {/* Trail: Print By / Picked By / Checked By */}
        <div className="ip-trail-box">
          <div className="ip-trail-row">
            <span>🖨️ Print By</span>
            <span>{doc.printedBy || "—"}</span>
          </div>
          <div className="ip-trail-row">
            <span>📦 Picked By</span>
            <span>{doc.pickedBy || "—"}</span>
          </div>
          <div className="ip-trail-row">
            <span>✅ Checked By</span>
            <span>{doc.checkedBy || "—"}</span>
          </div>
        </div>

        {/* Hold info banner */}
        {(sc === "onhold" || doc.deliveryHoldReason) && (
          <div className="ip-hold-box">
            <div className="ip-hold-row">
              <span>⏸ Hold Reason</span>
              <span>{doc.deliveryHoldReason || "—"}</span>
            </div>
            <div className="ip-hold-row">
              <span>Held By</span>
              <span>👤 {doc.deliveryHeldBy || "—"}</span>
            </div>
            <div className="ip-hold-row">
              <span>Held At</span>
              <span>{formatDateTime(doc.deliveryHoldTime)}</span>
            </div>
          </div>
        )}

        {/* Cancelled info banner — stays visible as history even if status later changes */}
        {doc.deliveryCancelReason && (
          <div className="ip-cancel-box">
            <div className="ip-cancel-row">
              <span>✕ Cancel Reason</span>
              <span>{doc.deliveryCancelReason || "—"}</span>
            </div>
            <div className="ip-cancel-row">
              <span>Cancelled By</span>
              <span>👤 {doc.deliveryCancelledBy || "—"}</span>
            </div>
            <div className="ip-cancel-row">
              <span>Cancelled At</span>
              <span>{formatDateTime(doc.deliveryCancelTime)}</span>
            </div>
          </div>
        )}

        {/* Delivery Done summary — stays visible as history even if status later changes */}
        {doc.deliveredBy && (
          <div className="ip-print-done-box">
            <div className="ip-print-done-row">
              <span>Delivered By</span>
              <span>👤 {doc.deliveredBy || "—"}</span>
            </div>
            <div className="ip-print-done-row">
              <span>Vehicle No</span>
              <span>🚐 {doc.deliveryVehicleNo || "—"}</span>
            </div>
          </div>
        )}

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Table Row ─────────────────────────────────────────────────────────────

function DocumentRow({ doc, onView, onDelivered, onHold, onCancelled }) {
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
      {Array.from({ length: 9 }).map((_, i) => (
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

  const [activePopup,  setActivePopup]  = useState(null); // "hold" | "delivered" | "cancel" | null
  const [activeId,     setActiveId]     = useState(null);
  const [viewDoc,       setViewDoc]     = useState(null);

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
  const closePopup = () => { setActivePopup(null); setActiveId(null); };

  // keep the view popup's data in sync after a refresh
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

  // ── Filters ──
  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];
  const statuses = ["ALL", ...new Set(documents.map(d => d.deliveryStatus).filter(Boolean))];

  const visible = documents.filter(doc => {
    const q = search.toLowerCase();
    const matchSearch = !q || [
      String(doc.id), doc.customerName, doc.jobwbs,
      doc.reservationNo, doc.enteredBy, doc.jobType, doc.printDocumentNo,
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
        <HoldPopup onConfirm={handleHoldConfirm} onCancel={closePopup} />
      )}
      {activePopup === "delivered" && (
        <DeliveryDonePopup onConfirm={handleDeliveryDoneConfirm} onCancel={closePopup} />
      )}
      {activePopup === "cancel" && (
        <CancelPopup onConfirm={handleCancelConfirm} onCancel={closePopup} />
      )}
      {viewDoc && (
        <ViewPopup doc={viewDoc} onClose={() => setViewDoc(null)} />
      )}

      {/* ── Header ── */}
      <div className="ip-header">
        <div className="ip-header-left">
          <h1>🚚 Delivery Portal</h1>
          <p>
            Check Done documents only
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
            <strong>{overdueCount}</strong> {overdueCount === 1 ? "document has" : "documents have"} been pending delivery for more than {OVERDUE_DAYS} days
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
            placeholder="Search by ID, Customer, WBS, Reservation, Print Doc No..."
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
                <td colSpan={9}>
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
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
