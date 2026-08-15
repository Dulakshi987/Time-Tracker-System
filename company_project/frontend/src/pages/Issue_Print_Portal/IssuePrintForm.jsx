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

// NOTE: AUTO_REFRESH is no longer used since the polling interval below
// has been disabled to cut down on Railway data usage. Left here (unused)
// in case auto-refresh is re-enabled later.
// const AUTO_REFRESH = 10000;

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

// Pagination
const PAGE_SIZE = 24;

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
// ACROSS THE WHOLE DATASET (fetched fresh from the server when the popup
// opens — not just the currently loaded page) — used to block duplicates.
function PrintDonePopup({
  onConfirm,
  onCancel,
  printOperators,
  operatorsLoading,
  initialDocumentNo,
  initialPrintedBy,
  isEdit,
  existingDocumentNos = [],
  existingDocsLoading,
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
          {existingDocsLoading && (
            <span style={{ fontSize: "0.72rem", color: "#6c8bb3" }}>Checking existing document numbers…</span>
          )}
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

  // ── Pagination — server-side. Only the current page's documents are
  // ever held in `documents`; stats come from the server too so the chips
  // reflect the FULL filtered set, not just what's on screen.
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [statsFromServer, setStatsFromServer] = useState({
    total: 0, pending: 0, inProgress: 0, onHold: 0, completed: 0,
  });

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

  // Document numbers already used ACROSS ALL documents (fetched fresh
  // from the server each time the Print Done / Edit popup opens, since
  // `documents` only holds the current page and can't be relied on for
  // a global duplicate check anymore).
  const [existingDocumentNos, setExistingDocumentNos] = useState([]);
  const [existingDocsLoading, setExistingDocsLoading] = useState(false);

  const [activePopup, setActivePopup] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [editValues, setEditValues] = useState({ documentNo: "", printedBy: "" });

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();

      if (dateFilterMode === "TODAY") {
        const today = getSriLankaTodayKey();
        params.set("from", today);
        params.set("to", today);
      } else if (dateFilterMode === "CUSTOM") {
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
      }
      if (filterType !== "ALL") params.set("jobType", filterType);
      if (filterStatus !== "ALL") params.set("status", filterStatus);
      if (search.trim()) params.set("search", search.trim());
      if (!isAdminRole && user?.divisions?.length) {
        params.set("divisions", user.divisions.join(","));
      }
      params.set("page", String(page));
      params.set("size", String(PAGE_SIZE));

      const res = await fetch(`${API_BASE}/search?${params.toString()}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();

      setDocuments(data.content || []);
      setTotalPages(data.totalPages || 0);
      setTotalElements(data.totalElements || 0);
      setStatsFromServer({
        total: data.stats?.total || 0,
        pending: data.stats?.pending || 0,
        inProgress: data.stats?.inProgress || 0,
        onHold: data.stats?.onHold || 0,
        completed: data.stats?.completed || 0,
      });
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateFilterMode, fromDate, toDate, filterType, filterStatus, search, page, isAdminRole, user]);

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

  // Document numbers already used, across the whole dataset — fetched
  // fresh each time the Print Done / Edit popup opens.
  const fetchExistingDocumentNos = useCallback(async (excludeId) => {
    setExistingDocsLoading(true);
    try {
      const params = new URLSearchParams();
      if (excludeId != null) params.set("excludeId", String(excludeId));
      const res = await fetch(`${API_BASE}/used-document-numbers?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setExistingDocumentNos(data || []);
      } else {
        setExistingDocumentNos([]);
      }
    } catch (e) {
      console.warn("Failed to load existing document numbers", e);
      setExistingDocumentNos([]);
    } finally {
      setExistingDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments(false);
  }, [fetchDocuments]);

  useEffect(() => {
    fetchDivisions();
  }, [fetchDivisions]);

  // Any filter/search/date change should reset back to page 0 — otherwise
  // you could land on a page that no longer exists for the new filter.
  useEffect(() => {
    setPage(0);
  }, [dateFilterMode, fromDate, toDate, filterType, filterStatus, search]);

  // ── Auto-refresh DISABLED to reduce Railway data usage ─────────────────
  // This used to poll the backend every AUTO_REFRESH (10s) on every open
  // tab/device, which was driving up Railway's daily usage. Data now only
  // loads on: initial page load / filter change (above), popup open
  // (operators + doc numbers), and the manual "↻ Refresh" button in the
  // header. Uncomment to re-enable polling if needed later.
  //
  // useEffect(() => {
  //   const id = setInterval(() => {
  //     fetchDocuments(true);
  //   }, AUTO_REFRESH);
  //   return () => clearInterval(id);
  // }, [fetchDocuments]);

  const getDocById = useCallback(
    (id) => documents.find(d => d.id === id),
    [documents]
  );

  const closePopup = () => {
    setActivePopup(null);
    setActiveId(null);
    setEditValues({ documentNo: "", printedBy: "" });
    setPopupOperators([]);
    setExistingDocumentNos([]);
  };

  const handleStart = async (id) => {
    if (!perms.start) return;
    try {
      await fetch(`${API_BASE}/${id}/start`, { method: "PUT" });
      fetchDocuments(true);
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
    await Promise.all([
      fetchOperatorsForDivision(doc?.divisionNo),
      fetchExistingDocumentNos(id),
    ]);
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
    await Promise.all([
      fetchOperatorsForDivision(doc?.divisionNo),
      fetchExistingDocumentNos(doc.id),
    ]);
  };

  // Delete — removes the document entirely
  const handleDeleteClick = async (id) => {
    if (!perms.delete) return;
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

  // documents already come back filtered, division-scoped, paged, and
  // with requestId attached from the server — nothing left to compute here.
  const visible = documents;

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

  // Stat chips — from the server, over the FULL filtered set (not just
  // the current page), so counts always match reality.
  const total = statsFromServer.total;
  const pending = statsFromServer.pending;
  const inProg = statsFromServer.inProgress;
  const onHold = statsFromServer.onHold;
  const completed = statsFromServer.completed;

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
          existingDocsLoading={existingDocsLoading}
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
            onClick={() => fetchDocuments(false)}
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
              requestId={doc.requestId}
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

      {/* Pagination controls */}
      {!loading && totalPages > 1 && (
        <div className="ip-toolbar" style={{ justifyContent: "center", marginTop: 20 }}>
          <button
            type="button"
            className="ip-btn ip-btn-outline"
            style={{ flex: "unset", padding: "8px 16px" }}
            disabled={page <= 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
          >
            ← Prev
          </button>
          <span style={{ color: "#6c8bb3", fontSize: "0.85rem" }}>
            Page {page + 1} of {totalPages} · {totalElements} total
          </span>
          <button
            type="button"
            className="ip-btn ip-btn-outline"
            style={{ flex: "unset", padding: "8px 16px" }}
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}