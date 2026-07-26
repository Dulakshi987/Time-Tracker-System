import { useState, useEffect, useCallback, useMemo } from "react";
import "./IssueCheck.css";

// const API_BASE = "http://localhost:8080/api/check-portal";
// const SETUP_API = "http://localhost:8080/api/admin-setup";

const API_BASE = "https://time-tracker-system-production.up.railway.app/api/check-portal";
const SETUP_API = "https://time-tracker-system-production.up.railway.app/api/admin-setup";
const AUTO_REFRESH = 10000;

const HOLD_REASONS = [
  "Waiting for documents",
  "Checker unavailable",
  "Waiting for approval",
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

// Same scheme as Print/Pick Portal — groups by request date, numbers
// within the day, e.g. 20260816/0001.
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

// ── Status helpers ───────────────────────────────────────────────────────────
// PENDING → [Start] → IN_PROGRESS
// IN_PROGRESS → [Hold] → ON_HOLD → [Start = Resume] → IN_PROGRESS
// IN_PROGRESS → [Report Wrong Material] → WRONG_MATERIAL (sent to Pick Portal
//   as an emergency). Once Pick Portal resolves it (emergencyPickResolved),
//   the checker can Resume and finish the check normally.
// IN_PROGRESS / ON_HOLD → [End] → COMPLETED (Checked)

function statusClass(doc) {
  const hasOpenIssue = (doc.hasWrongMaterial || "").toUpperCase() === "YES" && !doc.emergencyPickResolved;
  if (hasOpenIssue) return "wrongmaterial";
  const v = (doc.checkStatus || "").toLowerCase();
  if (v.includes("hold")) return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("complete") || v.includes("checked") || v.includes("done")) return "completed";
  return "pending";
}

function statusLabel(doc) {
  const c = statusClass(doc);
  return {
    pending: "Pending",
    inprogress: "In Progress",
    onhold: "On Hold",
    wrongmaterial: "Wrong Material",
    completed: "Checked",
  }[c];
}

// ── Person Picker (Only Master Data - No "Other") ───────────────────────────
function PersonPicker({ value, onChange, people, loading }) {
  return (
    <div className="ip-popup-options">
      {loading ? (
        <div className="ip-popup-empty">Loading checkers…</div>
      ) : people.length === 0 ? (
        <div className="ip-popup-empty">No checkers found for this division in Master Setup</div>
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
function HoldPopup({ onConfirm, onCancel, checkers, checkersLoading }) {
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
        <PersonPicker value={heldBy} onChange={setHeldBy} people={checkers} loading={checkersLoading} />

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

// ── Report Emergency Pick Error Popup ───────────────────────────────────────
// Only captures fields that exist on the backend entity: wrong_material_sku,
// wrong_material_qty, checked_by (has_wrong_material is set to "YES" on
// submit). The reason is restricted to Material Shortage / Different
// Material — Emergency Pick is never valid for a Material Excess situation,
// so that option is intentionally not offered here.
const SKU_MIN_LENGTH = 8;

const EMERGENCY_REASONS = [
  "Material Shortage",
  "Different Material",
];

function ReportIssuePopup({ onConfirm, onCancel, checkers, checkersLoading }) {
  const [reason, setReason] = useState("");
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("");
  const [checkedBy, setCheckedBy] = useState("");
  const [skuError, setSkuError] = useState("");

  const handleSkuChange = (e) => {
    const value = e.target.value;
    setSku(value);
    if (value.trim().length === 0) {
      setSkuError("");
    } else if (value.trim().length < SKU_MIN_LENGTH) {
      setSkuError(`Material code must be at least ${SKU_MIN_LENGTH} characters.`);
    } else {
      setSkuError("");
    }
  };

  const canConfirm = !!reason && sku.trim().length >= SKU_MIN_LENGTH && !!qty && !!checkedBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>🚨 Emergency Pick Error</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">This will alert the Pick Portal for an emergency re-pick</p>

        <span className="ip-popup-label">Reason</span>
        <div className="ip-popup-options" style={{ marginBottom: 16 }}>
          {EMERGENCY_REASONS.map(r => (
            <button
              key={r}
              className={`ip-popup-option ${reason === r ? "selected" : ""}`}
              onClick={() => setReason(r)}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="ip-popup-field">
          <span className="ip-popup-label">Wrong Material Code (min {SKU_MIN_LENGTH} characters)</span>
          <input
            className={`ip-popup-text-input ${skuError ? "ip-input-error" : ""}`}
            type="text"
            placeholder="Enter material code..."
            value={sku}
            onChange={handleSkuChange}
          />
          {skuError && <span className="ip-field-error">{skuError}</span>}
        </div>

        <div className="ip-popup-field">
          <span className="ip-popup-label">Quantity</span>
          <input
            className="ip-popup-text-input"
            type="number"
            min="0"
            placeholder="Enter quantity..."
            value={qty}
            onChange={e => setQty(e.target.value)}
          />
        </div>

        <span className="ip-popup-label">Checked By</span>
        <PersonPicker value={checkedBy} onChange={setCheckedBy} people={checkers} loading={checkersLoading} />

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-emergency"
            disabled={!canConfirm}
            onClick={() => onConfirm({ reason, sku: sku.trim(), qty, checkedBy })}
          >
            🚨 Report Issue
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Check Done (End) Popup — also used for Edit of a completed document ────
function CheckDonePopup({ onConfirm, onCancel, checkers, checkersLoading, initialCheckedBy, isEdit }) {
  const [checkedBy, setCheckedBy] = useState(initialCheckedBy || "");
  const canConfirm = !!checkedBy;

  return (
    <div className="ip-popup-overlay">
      <div className="ip-popup">
        <div className="ip-popup-head">
          <span>✅ {isEdit ? "Edit Check Details" : "Check Done"}</span>
          <button className="ip-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="ip-popup-sub">Select who completed this check</p>

        <span className="ip-popup-label">Checked By (End By)</span>
        <PersonPicker value={checkedBy} onChange={setCheckedBy} people={checkers} loading={checkersLoading} />

        <div className="ip-popup-foot">
          <button className="ip-btn ip-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="ip-btn ip-btn-done"
            disabled={!canConfirm}
            onClick={() => onConfirm(checkedBy)}
          >
            {isEdit ? "✅ Save Changes" : "✅ Check Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Document Card ──────────────────────────────────────────────────────────
function DocumentCard({ doc, requestId, divisionLabel, onStart, onHold, onReportIssue, onEnd, onEdit, onDelete }) {
  const sc = statusClass(doc);
  const jColor = jobTypeColor(doc.jobType);
  const isPending = sc === "pending";
  const isInProgress = sc === "inprogress";
  const isOnHold = sc === "onhold";
  const isWrongMaterial = sc === "wrongmaterial";
  const isDone = sc === "completed";

  const canStart = isPending || isOnHold;
  const canHold = isInProgress;
  const canEnd = isInProgress || isOnHold;

  return (
    <div className={`ip-card status-${sc}`}>
      {isWrongMaterial && (
        <div className="ip-emergency-banner">
          🚨 WRONG MATERIAL REPORTED — Waiting on Pick Portal
        </div>
      )}
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
               {divisionLabel}
            </div>
          )}
        </div>
        <span className={`ip-badge ${sc}`}>{statusLabel(doc)}</span>
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

        {(isOnHold || doc.checkHoldReason) && (
          <div className="ip-hold-box">
            <div className="ip-hold-row"><span>Hold Reason</span><span>{doc.checkHoldReason || "—"}</span></div>
            <div className="ip-hold-row"><span>Held By</span><span>👤 {doc.checkHeldBy || "—"}</span></div>
            <div className="ip-hold-row"><span>Held At</span><span>{formatDateTime(doc.checkHoldTime)}</span></div>
          </div>
        )}

        {(doc.hasWrongMaterial || "").toUpperCase() === "YES" && (
          <div className="ip-hold-box ip-issue-box">
            <div className="ip-hold-row"><span>Wrong SKU</span><span>{doc.wrongMaterialSku || "—"}</span></div>
            <div className="ip-hold-row"><span>Quantity</span><span>{doc.wrongMaterialQty || "—"}</span></div>
            <div className="ip-hold-row"><span>Checked By</span><span>👤 {doc.checkedBy || "—"}</span></div>
            <div className="ip-hold-row">
              <span>Emergency Pick</span>
              <span>{doc.emergencyPickResolved ? "✅ Resolved" : "⏳ Pending"}</span>
            </div>
            {doc.emergencyPickResolved && (
              <>
                <div className="ip-hold-row"><span>Resolved By</span><span>👤 {doc.emergencyPickResolvedBy || "—"}</span></div>
                <div className="ip-hold-row"><span>Resolved At</span><span>{formatDateTime(doc.emergencyResolvedTime)}</span></div>
              </>
            )}
          </div>
        )}

        {isDone && (
          <div className="ip-print-done-box">
            <div className="ip-print-done-row"><span>Checked By (End By)</span><span>👤 {doc.checkedBy || "—"}</span></div>
            <div className="ip-print-done-row"><span>Duration</span><span>⏱ {formatDuration(doc.checkDurationSeconds)}</span></div>
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
            <button className="ip-btn ip-btn-emergency" onClick={() => onReportIssue(doc.id)}>
              🚨 Emergency Pick Error
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
export default function IssueCheckFormat() {
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

  // Checkers shown in the currently open popup — scoped to that document's
  // Division (Admin Master Data, division-wise), same pattern as
  // Print Portal's popupOperators / Pick Portal's popupPickers.
  const [popupCheckers, setPopupCheckers] = useState([]);
  const [popupCheckersLoading, setPopupCheckersLoading] = useState(false);

  const [activePopup, setActivePopup] = useState(null); // "hold" | "issue" | "end" | null
  const [activeId, setActiveId] = useState(null);
  const [editValues, setEditValues] = useState({ checkedBy: "" });

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

  // Division-wise checkers — a DEDICATED "Checker Name Setup" master table
  // (separate from Print's "Operator Name Setup" and Pick's "Picker Name
  // Setup"), same as how the Pick Portal has its own /pickers endpoint
  // instead of reusing Print's /print-operators. If /checkers 404s or
  // returns nothing, add a "Checker Name Setup" screen + endpoint in
  // Admin Master Setup (mirrors the Operator/Picker setup screens) —
  // adjust the endpoint path below to match whatever your backend calls it.
  const fetchCheckersForDivision = useCallback(async (divisionNo) => {
    if (!divisionNo) {
      setPopupCheckers([]);
      return;
    }

    setPopupCheckersLoading(true);
    try {
      const res = await fetch(`${SETUP_API}/checkers`);
      if (res.ok) {
        const data = await res.json();
        setPopupCheckers(
          (data || [])
            .filter(c => {
              const cDivisionNo =
                c.divisionNo ||
                (c.division && c.division.divisionNo) ||
                "";
              return String(cDivisionNo) === String(divisionNo);
            })
            .map(c => c.checkerNicName || c.checkerName || c.name || c.fullName)
            .filter(Boolean)
        );
      } else {
        setPopupCheckers([]);
      }
    } catch (e) {
      console.warn("Failed to load checkers for division", e);
      setPopupCheckers([]);
    } finally {
      setPopupCheckersLoading(false);
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
    setEditValues({ checkedBy: "" });
    setPopupCheckers([]);
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
    await fetchCheckersForDivision(doc?.divisionNo);
  };

  const handleReportIssueClick = async (id) => {
    const doc = getDocById(id);
    setActiveId(id);
    setActivePopup("issue");
    await fetchCheckersForDivision(doc?.divisionNo);
  };

  const handleEndClick = async (id) => {
    const doc = getDocById(id);
    setActiveId(id);
    setEditValues({ checkedBy: "" });
    setActivePopup("end");
    await fetchCheckersForDivision(doc?.divisionNo);
  };

  // Edit — reopens the same popup pre-filled with the completed document's values
  const handleEditClick = async (doc) => {
    setActiveId(doc.id);
    setEditValues({ checkedBy: doc.checkedBy || "" });
    setActivePopup("end");
    await fetchCheckersForDivision(doc?.divisionNo);
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

  const handleHoldConfirm = async (checkHoldReason, checkHeldBy) => {
    const id = activeId;
    closePopup();
    try {
      await fetch(`${API_BASE}/${id}/hold`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkHoldReason, checkHeldBy }),
      });
      fetchDocuments(true);
    } catch (err) { alert("Hold failed: " + err.message); }
  };

  const handleReportIssueConfirm = async ({ reason, sku, qty, checkedBy }) => {
    const id = activeId;
    closePopup();
    try {
      await fetch(`${API_BASE}/${id}/report-issue`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hasWrongMaterial: "YES",
          // NOTE: the Issue entity has no dedicated reason column today, so
          // the reason is prefixed onto wrongMaterialSku so it isn't lost.
          // pickingErrorReason is also sent in case that column gets added
          // on the backend later — harmless extra field otherwise.
          wrongMaterialSku: `[${reason}] ${sku}`,
          wrongMaterialQty: qty,
          checkedBy,
          pickingErrorReason: reason,
        }),
      });
      fetchDocuments(true);
    } catch (err) { alert("Report failed: " + err.message); }
  };

  const handleCheckDoneConfirm = async (checkedBy) => {
    const id = activeId;
    closePopup();
    try {
      await fetch(`${API_BASE}/${id}/end`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkedBy }),
      });
      fetchDocuments(true);
    } catch (err) { alert("Check Done failed: " + err.message); }
  };

  const requestIdMap = useMemo(() => computeRequestIds(documents), [documents]);

  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];

  const STATUS_FILTERS = [
    { value: "ALL", label: "All Status" },
    { value: "pending", label: "Pending" },
    { value: "inprogress", label: "In Progress" },
    { value: "onhold", label: "On Hold" },
    { value: "completed", label: "Checked" },
  ];

  // "Pending" and "Wrong Material" are shown/filtered as one combined bucket —
  // a card's individual badge/border can still say "Wrong Material", but the
  // stat chip and dropdown filter treat them as "Pending".
  const isPendingBucket = (doc) => {
    const c = statusClass(doc);
    return c === "pending" || c === "wrongmaterial";
  };

  const visible = documents.filter(doc => {
    const q = search.toLowerCase();
    const matchSearch = !q || [
      String(doc.id), doc.jobwbs, doc.reservationNo,
      doc.enteredBy, doc.jobType, doc.printDocumentNo
    ].some(v => (v || "").toLowerCase().includes(q));

    const matchType = filterType === "ALL" || doc.jobType === filterType;
    const matchStatus =
      filterStatus === "ALL" ||
      (filterStatus === "pending" ? isPendingBucket(doc) : statusClass(doc) === filterStatus);

    return matchSearch && matchType && matchStatus;
  });

  const total = documents.length;
  const pending = documents.filter(isPendingBucket).length;
  const inProg = documents.filter(d => statusClass(d) === "inprogress").length;
  const onHold = documents.filter(d => statusClass(d) === "onhold").length;
  const completed = documents.filter(d => statusClass(d) === "completed").length;

  // clicking a stat chip filters the grid by that status (Total clears the filter)
  const handleStatClick = (statusValue) => setFilterStatus(statusValue);

  return (
    <div className="ip-page">
      {activePopup === "hold" && (
        <HoldPopup
          onConfirm={handleHoldConfirm}
          onCancel={closePopup}
          checkers={popupCheckers}
          checkersLoading={popupCheckersLoading}
        />
      )}
      {activePopup === "issue" && (
        <ReportIssuePopup
          onConfirm={handleReportIssueConfirm}
          onCancel={closePopup}
          checkers={popupCheckers}
          checkersLoading={popupCheckersLoading}
        />
      )}
      {activePopup === "end" && (
        <CheckDonePopup
          onConfirm={handleCheckDoneConfirm}
          onCancel={closePopup}
          checkers={popupCheckers}
          checkersLoading={popupCheckersLoading}
          initialCheckedBy={editValues.checkedBy}
          isEdit={!!editValues.checkedBy}
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
            placeholder="Search by ID, WBS, Reservation, Doc No..."
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

      {/* Stats — all clickable, each filters the grid by that status */}
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
          Checked <strong>{completed}</strong>
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
              onReportIssue={handleReportIssueClick}
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
