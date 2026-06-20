import { useState, useEffect, useCallback } from "react";
import "./IssueCheck.css";

const API_BASE = "http://localhost:8080/api/check-portal";
const AUTO_REFRESH = 10000;

const PEOPLE_OPTIONS = ["Bimsara", "Osura"];

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

  const isOtherReason = reason === "Other";
  const finalReason   = isOtherReason ? otherReason.trim() : reason;
  const canConfirm    = !!finalReason && !!heldBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>⏸ Hold Check</span>
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

// ── Popup: Check Done (Yes/No wrong material) ────────────────────────────────

function CheckDonePopup({ onConfirm, onCancel }) {
  const [checkedBy, setCheckedBy] = useState("");
  const [hasWrong, setHasWrong]   = useState(null); // "YES" | "NO" | null
  const [sku, setSku]             = useState("");
  const [qty, setQty]             = useState("");

  const needsDetails = hasWrong === "YES";
  const canConfirm =
    !!checkedBy &&
    hasWrong !== null &&
    (!needsDetails || (sku.trim().length > 0 && qty.trim().length > 0));

  const handleConfirm = () => {
    onConfirm(checkedBy, hasWrong, needsDetails ? sku.trim() : "", needsDetails ? qty.trim() : "");
  };

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>✅ Check Done</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Confirm who checked this and if there's a material issue</p>

        <span className="ip-popup-label">Checked By</span>
        <div style={{ marginBottom: 16 }}>
          <PersonPicker value={checkedBy} onChange={setCheckedBy} />
        </div>

        <span className="ip-popup-label">Wrong material collected?</span>
        <div className="ip-yesno-row" style={{ marginBottom: needsDetails ? 16 : 0 }}>
          <button
            className={`ip-yesno-btn yes ${hasWrong === "YES" ? "selected" : ""}`}
            onClick={() => setHasWrong("YES")}
          >
            ⚠️ Yes
          </button>
          <button
            className={`ip-yesno-btn no ${hasWrong === "NO" ? "selected" : ""}`}
            onClick={() => { setHasWrong("NO"); setSku(""); setQty(""); }}
          >
            ✅ No
          </button>
        </div>

        {needsDetails && (
          <>
            <div className="ip-popup-field" style={{ marginTop: 16 }}>
              <span className="ip-popup-label">SKU / Description</span>
              <input
                className="ip-popup-text-input"
                type="text"
                placeholder="Enter SKU or description..."
                value={sku}
                onChange={e => setSku(e.target.value)}
              />
            </div>
            <div className="ip-popup-field">
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

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            ✅ Check Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Single Document Card ─────────────────────────────────────────────────────

function DocumentCard({ doc, onStart, onHold, onEnd }) {
  const sc        = statusClass(doc.checkStatus);
  const jColor    = jobTypeColor(doc.jobType);
  const isPending = sc === "pending";
  const isStarted = sc === "inprogress";
  const isOnHold  = sc === "onhold";
  const isDone    = sc === "completed";
  const hasWrong  = (doc.hasWrongMaterial || "").toUpperCase() === "YES";

  return (
    <div className={`ip-card status-${sc}`}>
      {/* ── Head ── */}
      <div className="ip-card-head">
        <div>
          <div className="ip-doc-no">Doc #{doc.id}</div>
          <div style={{ color: jColor, fontWeight: 700, fontSize: "0.78rem", marginTop: 2 }}>
            {doc.jobType || "—"}
          </div>
        </div>
        <span className={`ip-badge ${sc}`}>{statusLabel(doc.checkStatus)}</span>
      </div>

      {/* ── Body ── */}
      <div className="ip-card-body">
        <div className="ip-detail-row">
          <span className="ip-detail-label">Customer</span>
          <span className="ip-detail-value">{doc.customerName || "—"}</span>
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

        {/* Check Done summary */}
        {isDone && (
          <>
            {hasWrong ? (
              <div className="ip-wrong-material-box">
                <div className="ip-wrong-material-row">
                  <span>⚠️ Wrong Material</span>
                  <span>{doc.wrongMaterialSku || "—"}</span>
                </div>
                <div className="ip-wrong-material-row">
                  <span>Quantity</span>
                  <span>{doc.wrongMaterialQty || "—"}</span>
                </div>
              </div>
            ) : (
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

      {/* ── Footer Buttons ── */}
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
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const [refreshing,   setRefreshing]   = useState(false);

  const [activePopup,  setActivePopup]  = useState(null); // "hold" | "end" | null
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
  const closePopup = () => { setActivePopup(null); setActiveId(null); };

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

  const handleCheckDoneConfirm = async (checkedBy, hasWrongMaterial, wrongMaterialSku, wrongMaterialQty) => {
    closePopup();
    try {
      await fetch(`${API_BASE}/${activeId}/end`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkedBy, hasWrongMaterial, wrongMaterialSku, wrongMaterialQty }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Check Done failed: " + err.message);
    }
  };

  // ── Filters ──
  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];
  const statuses = ["ALL", ...new Set(documents.map(d => d.checkStatus).filter(Boolean))];

  const visible = documents.filter(doc => {
    const q = search.toLowerCase();
    const matchSearch = !q || [
      String(doc.id), doc.customerName, doc.jobwbs,
      doc.reservationNo, doc.enteredBy, doc.jobType,
    ].some(v => (v || "").toLowerCase().includes(q));

    const matchType   = filterType   === "ALL" || doc.jobType === filterType;
    const matchStatus = filterStatus === "ALL" || doc.checkStatus === filterStatus;

    return matchSearch && matchType && matchStatus;
  });

  // Stats
  const total     = documents.length;
  const pending   = documents.filter(d => statusClass(d.checkStatus) === "pending").length;
  const inProg    = documents.filter(d => statusClass(d.checkStatus) === "inprogress").length;
  const onHold    = documents.filter(d => statusClass(d.checkStatus) === "onhold").length;
  const completed = documents.filter(d => statusClass(d.checkStatus) === "completed").length;

  return (
    <div className="ip-page">

      {activePopup === "hold" && (
        <HoldPopup onConfirm={handleHoldConfirm} onCancel={closePopup} />
      )}
      {activePopup === "end" && (
        <CheckDonePopup onConfirm={handleCheckDoneConfirm} onCancel={closePopup} />
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

      {/* ── Toolbar ── */}
      <div className="ip-toolbar">
        <div className="ip-search-wrap">
          <span className="ip-search-icon">🔍</span>
          <input
            className="ip-search"
            type="text"
            placeholder="Search by ID, Customer, WBS, Reservation..."
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
        <div className="ip-stat-chip"><strong style={{color:"#3b82f6"}}>{inProg}</strong> In Progress</div>
        <div className="ip-stat-chip"><strong style={{color:"#fb923c"}}>{onHold}</strong> On Hold</div>
        <div className="ip-stat-chip green">Check Done <strong>{completed}</strong></div>
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
