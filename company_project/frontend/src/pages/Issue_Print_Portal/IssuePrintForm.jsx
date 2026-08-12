import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "./IssuePrint.css";
import { formatSriLankaTime } from "../../utils/dateUtils";
import {
  getCurrentUser,
  logoutUser,
  canUseButton,
  canSeeDivision,
} from "../../config/permissions";

// const API_BASE = "http://localhost:8080/api/print-portal";
// const SETUP_API = "http://localhost:8080/api/admin-setup";

const API_BASE = "https://time-tracker-system-production.up.railway.app/api/print-portal";
const SETUP_API = "https://time-tracker-system-production.up.railway.app/api/admin-setup";

const PAGE_SIZE = 25;

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

// NOTE: request IDs are now numbered within the current page only (server
// no longer sends the full list). If you need a stable, gap-free sequence
// across pages, that numbering should move server-side (e.g. store/derive
// it in the DB) — this client-side version is fine for display purposes
// but the /0001, /0002 counters restart each page.
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

// ── Date filter helpers ──────────────────────────────────────────────────
// Returns today's date key (YYYY-MM-DD) in Sri Lanka time (UTC+5:30, no
// DST), regardless of what timezone the browser/server/device is actually
// running in. This is what "Today" always compares against, so the filter
// is correct no matter where the page is opened from.
function getSriLankaTodayKey() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const colomboMs = utcMs + 5.5 * 60 * 60000;
  const colombo = new Date(colomboMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${colombo.getFullYear()}-${pad(colombo.getMonth() + 1)}-${pad(colombo.getDate())}`;
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
// `existingDocumentNos` = document numbers already used by OTHER documents
// (the current document's own number, when editing, is excluded by the
// caller before this prop is passed in) — used to block duplicates.
//
// NOTE: since the frontend now only holds one page of documents at a time,
// this duplicate check only sees document numbers on the CURRENT page. A
// duplicate against a document sitting on a different page won't be caught
// client-side — if this matters, add a uniqueness constraint / server-side
// check on printDocumentNo in the /end endpoint.
function PrintDonePopup({
  onConfirm,
  onCancel,
  printOperators,
  operatorsLoading,
  initialDocumentNo,
  initialPrintedBy,
  isEdit,
  existingDocumentNos = [],
}) {
  const [documentNo, setDocumentNo] = useState(initialDocumentNo || "");
  const [printedBy, setPrintedBy] = useState(initialPrintedBy || "");
  const [docNoError, setDocNoError] = useState("");

  const isDuplicate = (value) => existingDocumentNos.includes(value);

  const canConfirm =
    isValidDocumentNo(documentNo) && !isDuplicate(documentNo) && !!printedBy;

  const handleDocumentNoChange = (e) => {
    // numbers only, max 10 digits
    const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, DOC_NO_MAX_LENGTH);
    setDocumentNo(digitsOnly);

    if (digitsOnly.length === 0) {
      setDocNoError("");
    } else if (!isValidDocumentNo(digitsOnly)) {
      setDocNoError(`Document Number must be numbers only (max ${DOC_NO_MAX_LENGTH} digits).`);
    } else if (isDuplicate(digitsOnly)) {
      setDocNoError("This Document Number is already used by another document.");
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
function DocumentCard({ doc, requestId, divisionLabel, perms, onStart, onHold, onEnd, onEdit, onDelete }) {
  const sc = statusClass(doc.printStatus);
  const jColor = jobTypeColor(doc.jobType);
  const isPending = sc === "pending";
  const isInProgress = sc === "inprogress";
  const isOnHold = sc === "onhold";
  const isDone = sc === "completed";

  // Role permission gates ANDed with the normal status-based gates.
  //
  // Hold -> Resume -> End flow:
  //   While a document is On Hold, ONLY "Resume" (the Start button, which
  //   relabels itself to "Resume") is available. "End" must NOT be
  //   accessible until the user has clicked Resume and the document is
  //   back "In Progress". So `canEnd` only checks isInProgress — it no
  //   longer includes isOnHold.
  const canStart = (isPending || isOnHold) && perms.start;
  const canHold = isInProgress && perms.hold;
  const canEnd = isInProgress && perms.end;

  const canEdit = isDone && perms.edit;
  const canDelete = isDone && perms.delete;

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
               {divisionLabel}
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
          <div className="ip-hold-row"><span>Held At</span><span>{formatSriLankaTime(doc.printHoldTime)}</span></div>
          {doc.printResumeTime && (
            <div className="ip-hold-row"><span>Resumed At</span><span>{formatSriLankaTime(doc.printResumeTime)}</span></div>
          )}
        </div>
        )}

        {isDone && (
        <div className="ip-print-done-box">
          <div className="ip-print-done-row"><span>Started At</span><span>{formatSriLankaTime(doc.printStartTime)}</span></div>
          <div className="ip-print-done-row"><span>Ended At</span><span>{formatSriLankaTime(doc.printEndTime)}</span></div>
          <div className="ip-print-done-row"><span>Document No</span><span>{doc.printDocumentNo || "—"}</span></div>
          <div className="ip-print-done-row"><span>Printed By</span><span>👤 {doc.printedBy || "—"}</span></div>
          <div className="ip-print-done-row"><span>Duration</span><span>⏱ {formatDuration(doc.printDurationSeconds)}</span></div>
        </div>
      )}
      </div>

      <div className="ip-card-foot">
        {isDone ? (
          (canEdit || canDelete) && (
            <>
              {canEdit && (
                <button className="ip-btn ip-btn-edit" onClick={() => onEdit(doc)}>
                  ✎ Edit
                </button>
              )}
              {canDelete && (
                <button className="ip-btn ip-btn-delete" onClick={() => onDelete(doc.id)}>
                  🗑 Delete
                </button>
              )}
            </>
          )
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
  const navigate = useNavigate();
  const user = useMemo(() => getCurrentUser(), []);

  // Button-level permissions for this role, computed once.
  const perms = useMemo(() => ({
    start: canUseButton(user, "start"),
    hold: canUseButton(user, "hold"),
    end: canUseButton(user, "end"),
    edit: canUseButton(user, "edit"),
    delete: canUseButton(user, "delete"),
  }), [user]);

  // Admin / System Administrator already have logout available elsewhere
  // (their own dashboard/navbar) — hide the in-portal Logout button for
  // them, same pattern as Pick / Delivery Portal. Everyone else (Printer,
  // Print with Document Enter, etc.) sees it.
  const isAdminRole =
    user?.staffName === "Admin" ||
    user?.staffName === "System Administrator";

  // Divisions this user is scoped to — sent to the backend so pagination
  // filters at the DB level instead of over-fetching and cutting client-side.
  // Admins pass `undefined` (no divisions param => backend returns all).
  const divisionsParam = useMemo(() => {
    if (isAdminRole) return undefined;
    if (Array.isArray(user?.divisions) && user.divisions.length > 0) {
      return user.divisions.join(",");
    }
    return undefined;
  }, [isAdminRole, user]);

  const handleLogout = () => {
    logoutUser();
    navigate("/", { replace: true });
  };

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Pagination — server returns PAGE_SIZE (25) rows at a time ─────────
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);

  // ── Date filter — defaults to "Today" (Sri Lanka time). "All" clears
  // it, "Custom" opens a From/To range.
  const [dateFilterMode, setDateFilterMode] = useState("TODAY"); // "TODAY" | "ALL" | "CUSTOM"
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Divisions (Admin Master Data) — used to label each card with its Division
  const [divisions, setDivisions] = useState([]);

  // Operators shown in the currently open popup — scoped to that
  // document's Division (Admin Master Data, division-wise)
  const [popupOperators, setPopupOperators] = useState([]);
  const [popupOperatorsLoading, setPopupOperatorsLoading] = useState(false);

  const [activePopup, setActivePopup] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [editValues, setEditValues] = useState({ documentNo: "", printedBy: "" });

  // ── Stats (Total / Pending / In Progress / On Hold / Completed) ───────
  // Computed in the database via COUNT queries, independent of which page
  // is currently loaded — so the chips always reflect the full filtered
  // set, not just the 25 rows on screen.
  const [stats, setStats] = useState({ total: 0, pending: 0, inProgress: 0, onHold: 0, completed: 0 });

  // The backend only understands a single exact date for now (used for
  // "Today" and the simple case of a Custom "from" date). If you need a
  // real from/to range server-side, extend the /paged and /stats params.
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

  // Division-wise operators — only the operators added under that
  // specific Division in Admin Master Data.
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

  // Reset to page 0 whenever a filter changes — otherwise you can land on
  // an out-of-range / empty page after narrowing the result set.
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

  const refreshAll = (silent) => {
    fetchDocuments(silent);
    fetchStats();
  };

  const handleStart = async (id) => {
    if (!perms.start) return;
    try {
      await fetch(`${API_BASE}/${id}/start`, { method: "PUT" });
      refreshAll(true);
    } catch (err) { alert("Start failed: " + err.message); }
  };

  const handleHoldClick = async (id) => {
    if (!perms.hold) return;
    const doc = getDocById(id);
    setActiveId(id);
    setActivePopup("hold");
    await fetchOperatorsForDivision(doc?.divisionNo);
  };

  const handleEndClick = async (id) => {
    if (!perms.end) return;
    const doc = getDocById(id);
    setActiveId(id);
    setEditValues({ documentNo: "", printedBy: "" });
    setActivePopup("end");
    await fetchOperatorsForDivision(doc?.divisionNo);
  };

  // Edit — reopens the same popup pre-filled with the completed document's values
  const handleEditClick = async (doc) => {
    if (!perms.edit) return;
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
    if (!perms.delete) return;
    if (!window.confirm("Delete this document permanently? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      refreshAll(true);
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
      refreshAll(true);
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
      refreshAll(true);
    } catch (err) { alert("Print Done failed: " + err.message); }
  };

  const requestIdMap = useMemo(() => computeRequestIds(documents), [documents]);

  // Document Numbers already used by OTHER documents on the CURRENT page —
  // passed into the Print Done / Edit popup to block duplicates. See the
  // note on PrintDonePopup above: this only sees the current page.
  const existingDocumentNos = useMemo(
    () =>
      documents
        .filter(d => d.id !== activeId)
        .map(d => d.printDocumentNo)
        .filter(Boolean),
    [documents, activeId]
  );

  const jobTypes = ["ALL", ...new Set(documents.map(d => d.jobType).filter(Boolean))];

  const STATUS_FILTERS = [
    { value: "ALL", label: "All Status" },
    { value: "pending", label: "Pending" },
    { value: "inprogress", label: "In Progress" },
    { value: "onhold", label: "On Hold" },
    { value: "completed", label: "Completed" },
  ];

  const DATE_FILTER_OPTIONS = [
    { value: "TODAY", label: "Today" },
    { value: "ALL", label: "All" },
    { value: "CUSTOM", label: "Custom" },
  ];

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
          existingDocumentNos={existingDocumentNos}
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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {user && (
            <span style={{ fontSize: "0.8rem", color: "#6c8bb3" }}>
              👤 {user.fullName || user.username} · {user.staffName}
            </span>
          )}
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

      {/* Date filter — Today (Sri Lanka time, default) / All / Custom range */}
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

      {/* Stats — DB-computed counts across the whole filtered set, not just this page */}
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
          className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "pending" ? "active" : ""}`}
          onClick={() => handleStatClick("pending")}
        >
          <strong style={{ color: "#b45309" }}>{stats.pending}</strong> Pending
        </button>
        <button
          type="button"
          className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "inprogress" ? "active" : ""}`}
          onClick={() => handleStatClick("inprogress")}
        >
          <strong style={{ color: "#1d4ed8" }}>{stats.inProgress}</strong> In Progress
        </button>
        <button
          type="button"
          className={`ip-stat-chip ip-stat-chip-clickable ${filterStatus === "onhold" ? "active" : ""}`}
          onClick={() => handleStatClick("onhold")}
        >
          <strong style={{ color: "#c2410c" }}>{stats.onHold}</strong> On Hold
        </button>
        <button
          type="button"
          className={`ip-stat-chip green ip-stat-chip-clickable ${filterStatus === "completed" ? "active" : ""}`}
          onClick={() => handleStatClick("completed")}
        >
          Completed <strong>{stats.completed}</strong>
        </button>
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid #ef4444", borderRadius: 8, padding: "12px 16px", color: "#b91c1c", marginBottom: 18 }}>
          ⚠ {error} — <button onClick={() => refreshAll(false)} style={{ color: "#1d4ed8", textDecoration: "underline" }}>retry</button>
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
        ) : documents.length === 0 ? (
          <div className="ip-empty">No documents found.</div>
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
              perms={perms}
              onStart={handleStart}
              onHold={handleHoldClick}
              onEnd={handleEndClick}
              onEdit={handleEditClick}
              onDelete={handleDeleteClick}
            />
          ))
        )}
      </div>

      {/* Pagination — 25 documents per page */}
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
