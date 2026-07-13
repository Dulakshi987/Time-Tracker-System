import { useState, useEffect, useCallback, useMemo } from "react";
import "./IssuePrint.css";

const API_BASE = "http://localhost:8080/api/print-portal";
const AUTO_REFRESH = 10000;

const PEOPLE_OPTIONS = ["Rashani", "Arushi", "Kawya", "Pathum", "Ruwan"];

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
        // order within the day by creation time if we have it, else by id
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

// ── Status helpers ────────────────────────────────────────────────────────────
// Internal state machine (drives button enabling / accent colors):
//   PENDING → [Handover] → HANDED_OVER → [Start] → IN_PROGRESS
//   IN_PROGRESS → [Hold] → ON_HOLD → [Start = Resume] → IN_PROGRESS
//   IN_PROGRESS / ON_HOLD → [End] → COMPLETED
//
// What the person actually SEES on the badge is always one of just 3 words:
//   Pending / Handovered / Completed

function statusClass(s) {
  const v = (s || "").toLowerCase();
  if (v.includes("cancel"))                                 return "cancelled";
  if (v.includes("complete") || v.includes("done"))          return "completed";
  if (v.includes("hold"))                                    return "onhold";
  if (v.includes("in_progress") || v.includes("progress"))   return "inprogress";
  if (v.includes("handed"))                                  return "handedover";
  return "pending";
}

// Badge text — always Pending / Handovered / Completed
function statusLabel(s) {
  const sc = statusClass(s);
  if (sc === "completed") return "Completed";
  if (sc === "pending")   return "Pending";
  return "Handovered"; // handedover, inprogress, onhold all read as "Handovered"
}

// Badge color grouping — pending / handedover(+inprogress+onhold) / completed
function badgeClass(s) {
  const sc = statusClass(s);
  if (sc === "completed") return "completed";
  if (sc === "pending")   return "pending";
  return "inprogress";
}

// ── Person Picker ─────────────────────────────────────────────────────────────

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
        >👤 {name}</button>
      ))}
      <button
        className={`ip-popup-option ${showOther ? "selected" : ""}`}
        onClick={() => { setShowOther(true); onChange(otherVal); }}
      >✏️ Other</button>
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

// ── Popup: Handover (Step 1 — separate from Start) ────────────────────────────

function HandoverPopup({ onConfirm, onCancel }) {
  const [handedOverBy, setHandedOverBy] = useState("");

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>🚀 Handover Document</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select who is handing over this document to print</p>

        <span className="ip-popup-label">Handed Over By</span>
        <PersonPicker value={handedOverBy} onChange={setHandedOverBy} />

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

// ── Popup: Hold Reason + Held By ─────────────────────────────────────────────

function HoldPopup({ onConfirm, onCancel }) {
  const [reason, setReason]         = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [heldBy, setHeldBy]         = useState("");

  const isOtherReason = reason === "Other";
  const finalReason   = isOtherReason ? otherReason.trim() : reason;
  const canConfirm    = !!finalReason && !!heldBy;

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
            >{r === "Other" ? "✏️ " : "⏸ "}{r}</button>
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
          >⏸ Confirm Hold</button>
        </div>
      </div>
    </div>
  );
}

// ── Popup: Print Done ─────────────────────────────────────────────────────────

function PrintDonePopup({ onConfirm, onCancel }) {
  const [documentNo, setDocumentNo] = useState("");
  const [printedBy, setPrintedBy]   = useState("");
  const canConfirm = documentNo.trim().length > 0 && !!printedBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>🖨️ Print Done</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Enter the document number and who printed it</p>

        <div className="ip-popup-field">
          <span className="ip-popup-label">Document Number</span>
          <input
            className="ip-popup-text-input"
            type="text"
            placeholder="Enter document number..."
            value={documentNo}
            onChange={e => setDocumentNo(e.target.value)}
            autoFocus
          />
        </div>

        <span className="ip-popup-label">Print By</span>
        <PersonPicker value={printedBy} onChange={setPrintedBy} />

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            disabled={!canConfirm}
            onClick={() => onConfirm(documentNo.trim(), printedBy)}
          >✅ Print Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Single Document Card ──────────────────────────────────────────────────────

function DocumentCard({ doc, requestId, onHandover, onStart, onHold, onEnd }) {
  const sc            = statusClass(doc.printStatus);
  const jColor        = jobTypeColor(doc.jobType);
  const isPending      = sc === "pending";
  const isHandedOver   = sc === "handedover";   // handed over, not started yet
  const isInProgress   = sc === "inprogress";   // work actively running
  const isOnHold       = sc === "onhold";
  const isDone         = sc === "completed";

  const canHandover = isPending;
  const canStart     = isHandedOver || isOnHold;    // Start = also acts as Resume
  const canHold      = isInProgress;
  const canEnd       = isInProgress || isOnHold;

  return (
    <div className={`ip-card status-${sc}`}>
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
        <span className={`ip-badge ${badgeClass(doc.printStatus)}`}>{statusLabel(doc.printStatus)}</span>
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
          <div className="ip-time-row">
            <span>Vehicle Number</span>
            <span>{doc.vehicleNo || "Not added"}</span>
          </div>
        </div>

        {/* Handed Over info — shown from the moment Handover is confirmed */}
        {!isPending && doc.printHandedOverBy && (
          <div className="ip-handover-box">
            <div className="ip-handover-row">
              <span>🚀 Handed Over By</span>
              <span>👤 {doc.printHandedOverBy}</span>
            </div>
          </div>
        )}

        {/* Hold info */}
        {(isOnHold || doc.printHoldReason) && (
          <div className="ip-hold-box">
            <div className="ip-hold-row">
              <span>⏸ Hold Reason</span>
              <span>{doc.printHoldReason || "—"}</span>
            </div>
            <div className="ip-hold-row">
              <span>Held By</span>
              <span>👤 {doc.printHeldBy || "—"}</span>
            </div>
            <div className="ip-hold-row">
              <span>Held At</span>
              <span>{formatDateTime(doc.printHoldTime)}</span>
            </div>
          </div>
        )}

        {/* Print Done summary */}
        {isDone && (
          <div className="ip-print-done-box">
            <div className="ip-print-done-row">
              <span>Document No</span>
              <span>{doc.printDocumentNo || "—"}</span>
            </div>
            <div className="ip-print-done-row">
              <span>Print By</span>
              <span>👤 {doc.printedBy || "—"}</span>
            </div>
            <div className="ip-print-done-row">
              <span>Duration</span>
              <span>⏱ {formatDuration(doc.printDurationSeconds)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer Buttons: Handover | Start | Hold | End ── */}
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
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="ip-card status-pending">
      <div className="ip-card-head">
        <div>
          <div className="ip-skeleton" style={{ width: 100, height: 15, marginBottom: 6 }} />
          <div className="ip-skeleton" style={{ width: 70,  height: 11 }} />
        </div>
        <div className="ip-skeleton" style={{ width: 72, height: 22, borderRadius: 12 }} />
      </div>
      <div className="ip-card-body">
        {[1,2,3,4].map(i => (
          <div key={i} className="ip-detail-row">
            <div className="ip-skeleton" style={{ width: 90,  height: 11 }} />
            <div className="ip-skeleton" style={{ width: 130, height: 11 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function IssuPrinFormt() {
  const [documents,    setDocuments]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [search,       setSearch]       = useState("");
  const [filterType,   setFilterType]   = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const [refreshing,   setRefreshing]   = useState(false);

  const [activePopup, setActivePopup] = useState(null); // "handover"|"hold"|"end"
  const [activeId,    setActiveId]    = useState(null);

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const res  = await fetch(API_BASE);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setDocuments(data);
      setLastUpdated(new Date());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchDocuments(false); }, [fetchDocuments]);
  useEffect(() => {
    const id = setInterval(() => fetchDocuments(true), AUTO_REFRESH);
    return () => clearInterval(id);
  }, [fetchDocuments]);

  const closePopup = () => { setActivePopup(null); setActiveId(null); };

  const handleHandoverClick = (id) => { setActiveId(id); setActivePopup("handover"); };
  const handleHoldClick     = (id) => { setActiveId(id); setActivePopup("hold"); };
  const handleEndClick      = (id) => { setActiveId(id); setActivePopup("end"); };

  // Handover confirm → PUT /handover
  const handleHandoverConfirm = async (handedOverBy) => {
    const id = activeId; closePopup();
    try {
      await fetch(`${API_BASE}/${id}/handover`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handedOverBy }),
      });
      fetchDocuments(true);
    } catch (err) { alert("Handover failed: " + err.message); }
  };

  // Start / Resume → PUT /start — direct action, no popup needed
  const handleStart = async (id) => {
    try {
      await fetch(`${API_BASE}/${id}/start`, { method: "PUT" });
      fetchDocuments(true);
    } catch (err) { alert("Start failed: " + err.message); }
  };

  const handleHoldConfirm = async (holdReason, heldBy) => {
    const id = activeId; closePopup();
    try {
      await fetch(`${API_BASE}/${id}/hold`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdReason, heldBy }),
      });
      fetchDocuments(true);
    } catch (err) { alert("Hold failed: " + err.message); }
  };

  const handlePrintDoneConfirm = async (printDocumentNo, printedBy) => {
    const id = activeId; closePopup();
    try {
      await fetch(`${API_BASE}/${id}/end`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printDocumentNo, printedBy }),
      });
      fetchDocuments(true);
    } catch (err) { alert("Print Done failed: " + err.message); }
  };

  // Request ID: date + daily sequence, e.g. 20260816/0001
  const requestIdMap = useMemo(() => computeRequestIds(documents), [documents]);

  // Job type options for filter dropdown (raw values, unaffected by status grouping)
  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];

  const STATUS_FILTERS = [
    { value: "ALL",        label: "All Status" },
    { value: "pending",    label: "Pending" },
    { value: "inprogress", label: "Handovered" },
    { value: "completed",  label: "Completed" },
  ];

  const visible = documents.filter(doc => {
    const q = search.toLowerCase();
    const matchSearch = !q || [
      String(doc.id), doc.jobwbs,
      doc.reservationNo, doc.enteredBy, doc.jobType,
      doc.requestedBy, doc.vehicleNo,
    ].some(v => (v || "").toLowerCase().includes(q));
    const matchType   = filterType   === "ALL" || doc.jobType === filterType;
    const matchStatus = filterStatus === "ALL" || badgeClass(doc.printStatus) === filterStatus;
    return matchSearch && matchType && matchStatus;
  });

  const total      = documents.length;
  const pending    = documents.filter(d => statusClass(d.printStatus) === "pending").length;
  const handedOver = documents.filter(d => {
    const sc = statusClass(d.printStatus);
    return sc === "handedover" || sc === "inprogress" || sc === "onhold";
  }).length;
  const completed  = documents.filter(d => statusClass(d.printStatus) === "completed").length;

  return (
    <div className="ip-page">

      {activePopup === "handover" && (
        <HandoverPopup onConfirm={handleHandoverConfirm} onCancel={closePopup} />
      )}
      {activePopup === "hold" && (
        <HoldPopup onConfirm={handleHoldConfirm} onCancel={closePopup} />
      )}
      {activePopup === "end" && (
        <PrintDonePopup onConfirm={handlePrintDoneConfirm} onCancel={closePopup} />
      )}

      {/* Header */}
      <div className="ip-header">
        <div className="ip-header-left">
          <h1>🖨️ Print Portal</h1>
          <p>Document Cart View
            {lastUpdated && (
              <span style={{ marginLeft:10, fontSize:"0.75rem", color:"#3b82f6" }}>
                {refreshing ? "⟳ Refreshing..." : `Updated: ${lastUpdated.toLocaleTimeString()}`}
              </span>
            )}
          </p>
        </div>
        <button className="ip-btn ip-btn-outline"
          style={{ flex:"unset", padding:"8px 18px" }}
          onClick={() => fetchDocuments(false)}>↻ Refresh</button>
      </div>

      {/* Toolbar */}
      <div className="ip-toolbar">
        <div className="ip-search-wrap">
          <span className="ip-search-icon">🔍</span>
          <input className="ip-search" type="text"
            placeholder="Search by ID, Customer, WBS, Reservation..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="ip-filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          {jobTypes.map(t => <option key={t} value={t}>{t === "ALL" ? "All Job Types" : t}</option>)}
        </select>
        <select className="ip-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {STATUS_FILTERS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </div>

      {/* Stats — Pending / Handovered / Completed */}
      <div className="ip-stats">
        <div className="ip-stat-chip blue">Total <strong>{total}</strong></div>
        <div className="ip-stat-chip"><strong style={{color:"#f59e0b"}}>{pending}</strong> Pending</div>
        <div className="ip-stat-chip"><strong style={{color:"#3b82f6"}}>{handedOver}</strong> Handovered</div>
        <div className="ip-stat-chip green">Completed <strong>{completed}</strong></div>
        <div className="ip-stat-chip">Showing <strong style={{color:"#a78bfa"}}>{visible.length}</strong> of {total}</div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background:"rgba(239,68,68,0.12)", border:"1px solid #ef4444",
          borderRadius:8, padding:"12px 16px", color:"#fca5a5", marginBottom:18, fontSize:"0.85rem" }}>
          ⚠ {error} — <button onClick={() => fetchDocuments(false)}
            style={{background:"none",border:"none",color:"#60a5fa",cursor:"pointer",textDecoration:"underline"}}>
            retry</button>
        </div>
      )}

      {/* Grid */}
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
            <DocumentCard key={doc.id} doc={doc}
              requestId={requestIdMap[doc.id]}
              onHandover={handleHandoverClick}
              onStart={handleStart}
              onHold={handleHoldClick}
              onEnd={handleEndClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
