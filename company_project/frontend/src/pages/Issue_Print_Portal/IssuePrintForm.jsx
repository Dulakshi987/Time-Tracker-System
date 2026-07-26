import { useState, useEffect, useCallback, useMemo } from "react";
import "./IssuePrint.css";

// const API_BASE = "http://localhost:8080/api/print-portal";
// const SETUP_API = "http://localhost:8080/api/admin-setup";

const API_BASE = "https://time-tracker-system-production.up.railway.app/api/print-portal";
const SETUP_API = "https://time-tracker-system-production.up.railway.app/api/admin-setup";
const AUTO_REFRESH = 10000;

const HOLD_REASONS = [
  "Printer not available",
  "Material shortage",
  "Waiting for approval",
  "Machine breakdown",
  "Other",
];

// Document Number rule: numbers only, max 10 digits
const DOC_NO_MAX_LENGTH = 10;
const isValidDocumentNo = (value) => /^\d{1,10}$/.test(value || "");

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
    balance: "#8b5cf6", domestic: "#16a34a", cost_center: "#b45309",
    commercial: "#1d4ed8", sales_order: "#db2777",
  };
  return map[(jt || "").toLowerCase().replace(/\s+/g, "_")] || "#64748b";
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
  return { pending: "Pending", inprogress: "In Progress", onhold: "On Hold", completed: "Completed" }[c];
}

// ── Person Picker (Only Master Data - No "Other") ───────────────────────────
function PersonPicker({ value, onChange, people, loading }) {
  return (
    <div className="ip-popup-options">
      {loading ? (
        <div className="ip-popup-empty">Loading operators…</div>
      ) : people.length === 0 ? (
        <div className="ip-popup-empty">No operators found for this division in Master Setup</div>
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

// ── Hold Popup ─────────────────────────────────────────────────────────────
function HoldPopup({ onConfirm, onCancel, printOperators, operatorsLoading }) {
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [heldBy, setHeldBy] = useState("");

  const isOther = reason === "Other";
  const finalReason = isOther ? otherReason.trim() : reason;
  const canConfirm = !!finalReason && !!heldBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>⏸ Hold Document</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select reason and who is holding</p>

        <span className="ip-popup-label">Hold Reason</span>
        <div className="ip-popup-options" style={{ marginBottom: 16 }}>
          {HOLD_REASONS.map(r => (
            <button
              key={r}
              className={`ip-popup-option ${reason === r ? "selected" : ""}`}
              onClick={() => setReason(r)}
            >
              {r}
            </button>
          ))}
          {isOther && (
            <input
              className="ip-popup-input"
              placeholder="Type reason..."
              value={otherReason}
              onChange={e => setOtherReason(e.target.value)}
              autoFocus
            />
          )}
        </div>

        <span className="ip-popup-label">Held By</span>
        <PersonPicker value={heldBy} onChange={setHeldBy} people={printOperators} loading={operatorsLoading} />

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

// ── Print Done Popup (also used for Edit of a completed document) ──────────
function PrintDonePopup({ onConfirm, onCancel, printOperators, operatorsLoading, initialDocumentNo, initialPrintedBy, isEdit }) {
  const [documentNo, setDocumentNo] = useState(initialDocumentNo || "");
  const [printedBy, setPrintedBy] = useState(initialPrintedBy || "");
  const [docNoError, setDocNoError] = useState("");

  const canConfirm = isValidDocumentNo(documentNo) && !!printedBy;

  const handleDocumentNoChange = (e) => {
    // numbers only, max 10 digits
    const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, DOC_NO_MAX_LENGTH);
    setDocumentNo(digitsOnly);

    if (digitsOnly.length === 0) {
      setDocNoError("");
    } else if (!isValidDocumentNo(digitsOnly)) {
      setDocNoError(`Document Number must be numbers only (max ${DOC_NO_MAX_LENGTH} digits).`);
    } else {
      setDocNoError("");
    }
  };

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>🖨️ {isEdit ? "Edit Print Details" : "Print Done"}</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Enter document number and printer</p>

        <div className="ip-popup-field">
          <span className="ip-popup-label">Document Number (numbers only, max {DOC_NO_MAX_LENGTH} digits)</span>
          <input
            className={`ip-popup-text-input ${docNoError ? "ip-input-error" : ""}`}
            type="text"
            inputMode="numeric"
            pattern="\d*"
            maxLength={DOC_NO_MAX_LENGTH}
            placeholder="Enter document number..."
            value={documentNo}
            onChange={handleDocumentNoChange}
            autoFocus
          />
          {docNoError && <span className="ip-field-error">{docNoError}</span>}
        </div>

        <span className="ip-popup-label">Printed By</span>
        <PersonPicker value={printedBy} onChange={setPrintedBy} people={printOperators} loading={operatorsLoading} />

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            disabled={!canConfirm}
            onClick={() => onConfirm(documentNo, printedBy)}
          >
            {isEdit ? "✅ Save Changes" : "✅ Print Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Document Card ──────────────────────────────────────────────────────────
function DocumentCard({ doc, requestId, divisionLabel, onStart, onHold, onEnd, onEdit, onDelete }) {
  const sc = statusClass(doc.printStatus);
  const jColor = jobTypeColor(doc.jobType);
  const isPending = sc === "pending";
  const isInProgress = sc === "inprogress";
  const isOnHold = sc === "onhold";
  const isDone = sc === "completed";

  const canStart = isPending || isOnHold;
  const canHold = isInProgress;
  const canEnd = isInProgress || isOnHold;

  return (
    <div className={`ip-card status-${sc}`}>
      <div className="ip-card-head">
        <div>
          <div className="ip-doc-no">{requestId || "—"}</div>
          <div className="ip-doc-number-sub">
            Doc No: {doc.printDocumentNo || "Not entered"}
          </div>
          <div style={{ color: jColor, fontWeight: 700, fontSize: "0.78rem", marginTop: 2 }}>
            {doc.jobType || "—"}
          </div>
          {divisionLabel && (
            <div className="ip-doc-division-sub">
              🏢 {divisionLabel}
            </div>
          )}
        </div>
        <span className={`ip-badge ${sc}`}>{statusLabel(doc.printStatus)}</span>
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

        <div className="ip-times">
          <div className="ip-time-row"><span>Request Date</span><span>{formatDate(doc.requestDate)}</span></div>
          <div className="ip-time-row"><span>Request Time</span><span>{formatTime(doc.requestTime)}</span></div>
          <div className="ip-time-row"><span>Vehicle No</span><span>{doc.vehicleNo || "Not added"}</span></div>
        </div>

        {(isOnHold || doc.printHoldReason) && (
          <div className="ip-hold-box">
            <div className="ip-hold-row"><span>Hold Reason</span><span>{doc.printHoldReason || "—"}</span></div>
            <div className="ip-hold-row"><span>Held By</span><span>👤 {doc.printHeldBy || "—"}</span></div>
            <div className="ip-hold-row"><span>Held At</span><span>{formatDateTime(doc.printHoldTime)}</span></div>
          </div>
        )}

        {isDone && (
          <div className="ip-print-done-box">
            <div className="ip-print-done-row"><span>Document No</span><span>{doc.printDocumentNo || "—"}</span></div>
            <div className="ip-print-done-row"><span>Printed By</span><span>👤 {doc.printedBy || "—"}</span></div>
            <div className="ip-print-done-row"><span>Duration</span><span>⏱ {formatDuration(doc.printDurationSeconds)}</span></div>
          </div>
        )}
      </div>

      <div className="ip-card-foot">
        {isDone ? (
          <>
            <button className="ip-btn ip-btn-edit" onClick={() => onEdit(doc)}>
              ✎ Edit
            </button>
            <button className="ip-btn ip-btn-delete" onClick={() => onDelete(doc.id)}>
              🗑 Delete
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
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function IssuPrinFormt() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Divisions (Admin Master Data) — used to label each card with its Division
  const [divisions, setDivisions] = useState([]);

  // Operators shown in the currently open popup — scoped to that
  // document's Division (Admin Master Data, division-wise)
  const [popupOperators, setPopupOperators] = useState([]);
  const [popupOperatorsLoading, setPopupOperatorsLoading] = useState(false);

  const [activePopup, setActivePopup] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [editValues, setEditValues] = useState({ documentNo: "", printedBy: "" });

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(API_BASE);
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

  // Division-wise operators — only the operators added under that
  // specific Division in Admin Master Data.
  // NOTE: the backend's /print-operators endpoint returns ALL operators
  // (there is no dedicated "by division" endpoint), so we fetch them all
  // and filter client-side. Master Setup shows each operator's division
  // as a "divisionNo — divisionName" code, so the stored field on each
  // operator is the divisionNo code (e.g. "4017"), not the division name —
  // match on that.
  const fetchOperatorsForDivision = useCallback(async (divisionNo) => {
    if (!divisionNo) {
      setPopupOperators([]);
      return;
    }

    setPopupOperatorsLoading(true);
    try {
      const res = await fetch(`${SETUP_API}/print-operators`);
      if (res.ok) {
        const data = await res.json();
        setPopupOperators(
          (data || [])
            .filter(op => {
              const opDivisionNo =
                op.divisionNo ||
                (op.division && op.division.divisionNo) ||
                "";
              return String(opDivisionNo) === String(divisionNo);
            })
            .map(op => op.operatorNicName || op.operatorName || op.name || op.fullName)
            .filter(Boolean)
        );
      } else {
        setPopupOperators([]);
      }
    } catch (e) {
      console.warn("Failed to load operators for division", e);
      setPopupOperators([]);
    } finally {
      setPopupOperatorsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments(false);
    fetchDivisions();
  }, [fetchDocuments, fetchDivisions]);

  useEffect(() => {
    const id = setInterval(() => {
      fetchDocuments(true);
    }, AUTO_REFRESH);
    return () => clearInterval(id);
  }, [fetchDocuments]);

  const getDocById = useCallback(
    (id) => documents.find(d => d.id === id),
    [documents]
  );

  const closePopup = () => {
    setActivePopup(null);
    setActiveId(null);
    setEditValues({ documentNo: "", printedBy: "" });
    setPopupOperators([]);
  };

  const handleStart = async (id) => {
    try {
      await fetch(`${API_BASE}/${id}/start`, { method: "PUT" });
      fetchDocuments(true);
    } catch (err) { alert("Start failed: " + err.message); }
  };

  const handleHoldClick = async (id) => {
    const doc = getDocById(id);
    setActiveId(id);
    setActivePopup("hold");
    await fetchOperatorsForDivision(doc?.divisionNo);
  };

  const handleEndClick = async (id) => {
    const doc = getDocById(id);
    setActiveId(id);
    setEditValues({ documentNo: "", printedBy: "" });
    setActivePopup("end");
    await fetchOperatorsForDivision(doc?.divisionNo);
  };

  // Edit — reopens the same popup pre-filled with the completed document's values
  const handleEditClick = async (doc) => {
    setActiveId(doc.id);
    setEditValues({
      documentNo: doc.printDocumentNo || "",
      printedBy: doc.printedBy || "",
    });
    setActivePopup("end");
    await fetchOperatorsForDivision(doc?.divisionNo);
  };

  // Delete — removes the document entirely
  const handleDeleteClick = async (id) => {
    if (!window.confirm("Delete this document permanently? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      fetchDocuments(true);
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  const handleHoldConfirm = async (holdReason, heldBy) => {
    const id = activeId;
    closePopup();
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
    const id = activeId;
    closePopup();
    try {
      await fetch(`${API_BASE}/${id}/end`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printDocumentNo, printedBy }),
      });
      fetchDocuments(true);
    } catch (err) { alert("Print Done failed: " + err.message); }
  };

  const requestIdMap = useMemo(() => computeRequestIds(documents), [documents]);

  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];

  const STATUS_FILTERS = [
    { value: "ALL", label: "All Status" },
    { value: "pending", label: "Pending" },
    { value: "inprogress", label: "In Progress" },
    { value: "onhold", label: "On Hold" },
    { value: "completed", label: "Completed" },
  ];

  const visible = documents.filter(doc => {
    const q = search.toLowerCase();
    const matchSearch = !q || [
      String(doc.id), doc.jobwbs, doc.reservationNo,
      doc.enteredBy, doc.jobType, doc.requestedBy, doc.vehicleNo
    ].some(v => (v || "").toLowerCase().includes(q));

    const matchType = filterType === "ALL" || doc.jobType === filterType;
    const matchStatus = filterStatus === "ALL" || statusClass(doc.printStatus) === filterStatus;

    return matchSearch && matchType && matchStatus;
  });

  const total = documents.length;
  const pending = documents.filter(d => statusClass(d.printStatus) === "pending").length;
  const inProg = documents.filter(d => statusClass(d.printStatus) === "inprogress").length;
  const onHold = documents.filter(d => statusClass(d.printStatus) === "onhold").length;
  const completed = documents.filter(d => statusClass(d.printStatus) === "completed").length;

  // clicking a stat chip filters the grid by that status (Total clears the filter)
  const handleStatClick = (statusValue) => setFilterStatus(statusValue);

  return (
    <div className="ip-page">
      {activePopup === "hold" && (
        <HoldPopup
          onConfirm={handleHoldConfirm}
          onCancel={closePopup}
          printOperators={popupOperators}
          operatorsLoading={popupOperatorsLoading}
        />
      )}
      {activePopup === "end" && (
        <PrintDonePopup
          onConfirm={handlePrintDoneConfirm}
          onCancel={closePopup}
          printOperators={popupOperators}
          operatorsLoading={popupOperatorsLoading}
          initialDocumentNo={editValues.documentNo}
          initialPrintedBy={editValues.printedBy}
          isEdit={!!editValues.documentNo || !!editValues.printedBy}
        />
      )}

      <div className="ip-header">
        <div className="ip-header-left">
          <h1>LOGITRACK-WAREHOUSE TIME EFFICENCY TRACKER SYSTEM</h1>
          <h1>  Print Portal</h1>
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
      {/* Toolbar */}
      <div className="ip-toolbar">
        <div className="ip-search-wrap">
          <span className="ip-search-icon">🔍</span>
          <input
            className="ip-search"
            type="text"
            placeholder="Search by ID, WBS, Reservation..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="ip-filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          {jobTypes.map(t => (
            <option key={t} value={t}>{t === "ALL" ? "All Job Types" : t}</option>
          ))}
        </select>
        <select className="ip-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {STATUS_FILTERS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Stats — now clickable, each filters the grid by that status */}
      <div className="ip-stats">
        <button
          type="button"
          className={`ip-stat-chip blue ip-stat-chip-clickable ${filterStatus === "ALL" ? "active" : ""}`}
          onClick={() => handleStatClick("ALL")}
        >
          Total <strong>{total}</strong>
        </button>
        <button
          type="button"
          className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "pending" ? "active" : ""}`}
          onClick={() => handleStatClick("pending")}
        >
          <strong style={{ color: "#b45309" }}>{pending}</strong> Pending
        </button>
        <button
          type="button"
          className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "inprogress" ? "active" : ""}`}
          onClick={() => handleStatClick("inprogress")}
        >
          <strong style={{ color: "#1d4ed8" }}>{inProg}</strong> In Progress
        </button>
        <button
          type="button"
          className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "onhold" ? "active" : ""}`}
          onClick={() => handleStatClick("onhold")}
        >
          <strong style={{ color: "#c2410c" }}>{onHold}</strong> On Hold
        </button>
        <button
          type="button"
          className={`ip-stat-chip green ip-stat-chip-clickable ${filterStatus === "completed" ? "active" : ""}`}
          onClick={() => handleStatClick("completed")}
        >
          Completed <strong>{completed}</strong>
        </button>
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid #ef4444", borderRadius: 8, padding: "12px 16px", color: "#b91c1c", marginBottom: 18 }}>
          ⚠ {error} — <button onClick={() => fetchDocuments(false)} style={{ color: "#1d4ed8", textDecoration: "underline" }}>retry</button>
        </div>
      )}

      <div className="ip-grid">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="ip-card status-pending">
              {/* Simple skeleton */}
              <div className="ip-card-head" style={{ opacity: 0.6 }}>
                <div style={{ height: 40, background: "#e2e8f0", borderRadius: 4 }} />
              </div>
            </div>
          ))
        ) : visible.length === 0 ? (
          <div className="ip-empty">No documents found.</div>
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
              onStart={handleStart}
              onHold={handleHoldClick}
              onEnd={handleEndClick}
              onEdit={handleEditClick}
              onDelete={handleDeleteClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
