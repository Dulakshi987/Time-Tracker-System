import { useState, useEffect, useCallback, useMemo } from "react";
import ExcelUpload from "./ExcelUpload";
import {
  createDocument,
  updateDocument,
  deleteDocument,
  fetchAllDocuments,
  fetchJobCategories,
  fetchPrintOperatorsByDivision,
  fetchDivisions,
} from "../../services/Documents_Portal/api";
import { getCurrentUser, canUseButton, hasAllDivisionAccess, canSeeDivision } from "../../config/permissions";
import "./DocumentsForm.css";

const getCurrentDate = () => new Date().toISOString().split("T")[0];
const getCurrentTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// Reservation No must be exactly 10 digits, numbers only
const RESERVATION_NO_LENGTH = 10;
const isValidReservationNo = (value) =>
  new RegExp(`^\\d{${RESERVATION_NO_LENGTH}}$`).test(value || "");

const emptyForm = (jobType) => ({
  jobType: jobType || "",
  jobWBS: "",
  reservationNo: "",
  customerName: "",
  enteredBy: "",
  requestedBy: "",
  vehicleNo: "",
  sapIssueLineNo: "",
  divisionNo: "",
  requestDate: getCurrentDate(),
  requestTime: getCurrentTime(),
  status: "Not Started",
});

const emptyTableFilters = () => ({
  search: "",
  jobType: "ALL",
  divisionNo: "ALL",
  status: "ALL",
});

// ── Date filter options — Today (Sri Lanka time, default) / All / Custom
// range. Same pattern as Print Portal / Pick Portal / Check Portal.
const DATE_FILTER_OPTIONS = [
  { value: "TODAY", label: "Today" },
  { value: "ALL", label: "All" },
  { value: "CUSTOM", label: "Custom" },
];

// Returns today's date key (YYYY-MM-DD) in Sri Lanka time (UTC+5:30, no
// DST), regardless of what timezone the browser/server/device is actually
// running in. Mirrors Check Portal / Print Portal / Pick Portal exactly.
function getSriLankaTodayKey() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const colomboMs = utcMs + 5.5 * 60 * 60000;
  const colombo = new Date(colomboMs);
  const pad = (n) => String(n).padStart(2, "0");
  return `${colombo.getFullYear()}-${pad(colombo.getMonth() + 1)}-${pad(colombo.getDate())}`;
}

// requestDate is stored as a plain date (no time/timezone component), so a
// straight string comparison against YYYY-MM-DD keys is correct as-is.
function docDateKey(row) {
  return row.requestDate ? String(row.requestDate).substring(0, 10) : null;
}

function matchesDateFilter(row, mode, fromDate, toDate) {
  if (mode === "ALL") return true;

  const key = docDateKey(row);

  if (mode === "TODAY") {
    return key === getSriLankaTodayKey();
  }

  if (mode === "CUSTOM") {
    if (!fromDate && !toDate) return true;
    if (!key) return false;
    if (fromDate && key < fromDate) return false;
    if (toDate && key > toDate) return false;
    return true;
  }

  return true;
}

// ── Duplicate row detection (ALL columns must match, incl. Request Time
// and Request Date) ──────────────────────────────────────────────────────
// A row is only flagged as a duplicate when EVERY column matches another
// row's — Job Type, Division, WBS, Reservation No, Customer, Entered By,
// Requested By, Vehicle No, SAP Line No, Request Date AND Request Time.
// Status is still excluded, since it changes as a document moves through
// Print/Pick/Check Portal — that's workflow progress, not a difference in
// what was entered.
function duplicateKeyOf(row) {
  const parts = [
    row.jobType,
    row.divisionNo,
    row.jobwbs || row.jobWBS,
    row.reservationNo,
    row.customerName,
    row.enteredBy,
    row.requestedBy,
    row.vehicleNo,
    row.sapIssueLineNo,
    row.requestDate,
    row.requestTime,
  ].map(v => String(v ?? "").trim().toLowerCase());

  // Nothing meaningful to compare (an entirely blank row) — never flag it.
  if (parts.every(p => p === "")) return null;

  return parts.join("||");
}

const DocumentForm = ({ selectedType }) => {
  const safeSelectedType = selectedType || "Summary";
  const isSummary = safeSelectedType === "Summary" || safeSelectedType === "All";

  // ── Role permissions ────────────────────────────────────────────────
  // "Document Enter" only gets the normal entry form + a read-only table
  // view. Edit/Delete on existing rows is reserved for Admin / System
  // Administrator (permissions.js: buttons "*"). "Print with Document
  // Enter" behaves the same as plain Document Enter here unless you
  // explicitly add "edit"/"delete" to its buttons list in permissions.js.
  const user = useMemo(() => getCurrentUser(), []);
  const canEdit = canUseButton(user, "edit");
  const canDelete = canUseButton(user, "delete");
  const showActionsColumn = canEdit || canDelete;

  const [formData, setFormData] = useState(emptyForm(isSummary ? "" : safeSelectedType));
  const [editingId, setEditingId] = useState(null);

  const [divisions, setDivisions] = useState([]);
  const [divisionsLoading, setDivisionsLoading] = useState(true);

  const [jobCategories, setJobCategories] = useState([]);
  const [jobCategoriesLoading, setJobCategoriesLoading] = useState(true);

  const [enteredByOptions, setEnteredByOptions] = useState([]);
  const [enteredByLoading, setEnteredByLoading] = useState(true);

  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState(null);
  const [tableFilters, setTableFilters] = useState(emptyTableFilters());

  // ── Date filter — defaults to "Today" (Sri Lanka time). "All" clears
  // it, "Custom" opens a From/To range. Mirrors Check Portal / Print
  // Portal / Pick Portal.
  const [dateFilterMode, setDateFilterMode] = useState("TODAY"); // "TODAY" | "ALL" | "CUSTOM"
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  // field-level validation errors
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    setFormData(emptyForm(isSummary ? "" : safeSelectedType));
    setEditingId(null);
    setSaveMsg(null);
    setFieldErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSelectedType]);

  useEffect(() => {
    setDivisionsLoading(true);
    fetchDivisions()
      .then(res => setDivisions(res.data || res || []))
      .catch(() => setDivisions([]))
      .finally(() => setDivisionsLoading(false));
  }, []);

  useEffect(() => {
    setJobCategoriesLoading(true);
    fetchJobCategories()
      .then(res => setJobCategories(res.data || []))
      .catch(() => setJobCategories([]))
      .finally(() => setJobCategoriesLoading(false));
  }, []);

  useEffect(() => {
    if (!formData.divisionNo) {
      setEnteredByOptions([]);
      return;
    }
    setEnteredByLoading(true);
    fetchPrintOperatorsByDivision(formData.divisionNo)
      .then(res => setEnteredByOptions(res.data || []))
      .catch(() => setEnteredByOptions([]))
      .finally(() => setEnteredByLoading(false));
  }, [formData.divisionNo]);

  const divisionNoToName = useMemo(() => {
    const map = {};
    divisions.forEach(d => { map[d.divisionNo] = d.divisionName; });
    return map;
  }, [divisions]);

  const filteredJobTypes = useMemo(() => {
    if (!formData.divisionNo) return [];
    const divisionName = divisionNoToName[formData.divisionNo];
    return jobCategories.filter(c => c.divisionName === divisionName);
  }, [jobCategories, formData.divisionNo, divisionNoToName]);

  const filteredEnteredBy = enteredByOptions;

  const handleDivisionChange = (e) => {
    const newDivision = e.target.value;
    setFormData(prev => ({
      ...prev,
      divisionNo: newDivision,
      jobType: "",
      enteredBy: "",
      status: newDivision ? "Document Entry Pending" : "Not Started",
    }));
  };

  const loadRows = useCallback(() => {
    setRowsLoading(true);
    fetchAllDocuments()
      .then(res => { setRows(res.data || []); setRowsError(null); })
      .catch(err => setRowsError(err.message || "Failed to load documents"))
      .finally(() => setRowsLoading(false));
  }, []);

  useEffect(() => { loadRows(); }, [loadRows]);

  // ── Division scoping (login-wise access) ────────────────────────────
  // Admin / System Administrator (allDivisions: true) see every document.
  // Every other role is hard-scoped to only the division(s) assigned to
  // their User Account in Master Setup — same rule Check Portal /
  // AdminDashboard already use.
  const scopedRows = useMemo(() => {
    return hasAllDivisionAccess(user)
      ? rows
      : rows.filter(r => canSeeDivision(user, r.divisionNo));
  }, [rows, user]);

  // ── Duplicate row detection & first/duplicate marking ───────────────
  // Scanned across ALL rows the user can see (not just the filtered/
  // visible subset), so a duplicate is still flagged even if one of the
  // matching rows is currently hidden by a search/filter. Within each
  // group of fully-matching rows, the FIRST one to appear (the one higher
  // up / entered earlier) is marked "first" (green) and every later
  // occurrence is marked "duplicate" (red).
  const rowHighlightMap = useMemo(() => {
    const groups = {};
    scopedRows.forEach(r => {
      const key = duplicateKeyOf(r);
      if (!key) return;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r.id);
    });

    const map = {};
    Object.values(groups).forEach(ids => {
      if (ids.length < 2) return; // no duplicate — leave unmarked
      ids.forEach((id, idx) => {
        map[id] = idx === 0 ? "first" : "duplicate";
      });
    });
    return map;
  }, [scopedRows]);

  const duplicateCount = useMemo(
    () => Object.values(rowHighlightMap).filter(v => v === "duplicate").length,
    [rowHighlightMap]
  );

  const handleChange = (e) => {
    const { name, value } = e.target;

    // Reservation No: allow digits only, max 8 characters
    if (name === "reservationNo") {
      const digitsOnly = value.replace(/\D/g, "").slice(0, RESERVATION_NO_LENGTH);
      setFormData(prev => ({ ...prev, reservationNo: digitsOnly }));

      setFieldErrors(prev => {
        const next = { ...prev };
        if (digitsOnly.length === 0) {
          delete next.reservationNo; // don't show error while empty/untouched
        } else if (!isValidReservationNo(digitsOnly)) {
          next.reservationNo = `Reservation No must be exactly ${RESERVATION_NO_LENGTH} digits.`;
        } else {
          delete next.reservationNo;
        }
        return next;
      });
      return;
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const validateForm = () => {
    const errors = {};

    if (formData.reservationNo && !isValidReservationNo(formData.reservationNo)) {
      errors.reservationNo = `Reservation No must be exactly ${RESERVATION_NO_LENGTH} digits (numbers only).`;
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Editing an existing row (not a fresh save) requires edit permission.
    if (editingId && !canEdit) {
      setSaveMsg({ type: "error", text: "You don't have permission to edit documents." });
      return;
    }

    if (!formData.divisionNo) {
      setSaveMsg({ type: "error", text: "Please select a Division before saving." });
      return;
    }

    if (!formData.jobType) {
      setSaveMsg({ type: "error", text: "Please select a Job Type before saving." });
      return;
    }

    if (formData.reservationNo && !isValidReservationNo(formData.reservationNo)) {
      setSaveMsg({ type: "error", text: `Reservation No must be exactly ${RESERVATION_NO_LENGTH} digits (numbers only).` });
      return;
    }

    if (!validateForm()) {
      setSaveMsg({ type: "error", text: "Please fix the highlighted fields before saving." });
      return;
    }

    setSaving(true);
    setSaveMsg(null);

    const payload = {
      ...formData,
      jobType: formData.jobType,
      divisionNo: formData.divisionNo,
      status: editingId ? formData.status : "Print Pending",
    };

    try {
      if (editingId) {
        await updateDocument(editingId, payload);
        setSaveMsg({ type: "ok", text: "Document updated." });
      } else {
        await createDocument(payload);
        setSaveMsg({ type: "ok", text: "Saved — this job now shows in the Print Portal cart." });
      }
      setFormData(emptyForm(isSummary ? "" : safeSelectedType));
      setEditingId(null);
      setFieldErrors({});
      loadRows();
    } catch (error) {
      setSaveMsg({ type: "error", text: error?.response?.data || error.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row) => {
    if (!canEdit) return;
    setEditingId(row.id);
    setFieldErrors({});
    setFormData({
      jobType: row.jobType || safeSelectedType,
      jobWBS: row.jobwbs || row.jobWBS || "",
      reservationNo: row.reservationNo || "",
      customerName: row.customerName || "",
      enteredBy: row.enteredBy || "",
      requestedBy: row.requestedBy || "",
      vehicleNo: row.vehicleNo || "",
      sapIssueLineNo: row.sapIssueLineNo || "",
      divisionNo: row.divisionNo || "",
      requestDate: row.requestDate || getCurrentDate(),
      requestTime: row.requestTime || getCurrentTime(),
      status: row.status || "Draft",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFieldErrors({});
    setFormData(emptyForm(isSummary ? "" : safeSelectedType));
  };

  const removeRow = async (id) => {
    if (!canDelete) return;
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    try {
      await deleteDocument(id);
      loadRows();
    } catch (error) {
      alert(error?.response?.data || error.message || "Delete failed");
    }
  };

  // Job type / status filter dropdown options — scoped to what this user
  // is actually allowed to see, same rule as the table itself.
  const rowJobTypeOptions = useMemo(() => {
    const set = new Set();
    scopedRows.forEach(r => { if (r.jobType) set.add(r.jobType); });
    return Array.from(set).sort();
  }, [scopedRows]);

  const rowStatusOptions = useMemo(() => {
    const set = new Set();
    scopedRows.forEach(r => { if (r.status) set.add(r.status); });
    return Array.from(set).sort();
  }, [scopedRows]);

  const handleTableFilterChange = (field, value) => {
    setTableFilters(prev => ({ ...prev, [field]: value }));
  };

  const clearTableFilters = () => setTableFilters(emptyTableFilters());

  const filteredRows = useMemo(() => {
    const s = tableFilters.search.trim().toLowerCase();

    return scopedRows.filter(row => {
      if (tableFilters.jobType !== "ALL" && (row.jobType || "") !== tableFilters.jobType) return false;
      if (tableFilters.divisionNo !== "ALL" && (row.divisionNo || "") !== tableFilters.divisionNo) return false;
      if (tableFilters.status !== "ALL" && (row.status || "Draft") !== tableFilters.status) return false;
      if (!matchesDateFilter(row, dateFilterMode, fromDate, toDate)) return false;

      if (!s) return true;

      const divisionLabel = row.divisionNo
        ? `${row.divisionNo} ${divisionNoToName[row.divisionNo] || ""}`
        : "";
      const hay = [
        row.id,
        row.jobType,
        row.divisionNo,
        divisionLabel,
        row.jobwbs || row.jobWBS,
        row.reservationNo,
        row.customerName,
        row.enteredBy,
        row.requestedBy,
        row.vehicleNo,
        row.sapIssueLineNo,
        row.requestDate,
        row.requestTime,
        row.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(s);
    });
  }, [scopedRows, tableFilters, divisionNoToName, dateFilterMode, fromDate, toDate]);

  const hasActiveTableFilters =
    tableFilters.search.trim() !== "" ||
    tableFilters.jobType !== "ALL" ||
    tableFilters.divisionNo !== "ALL" ||
    tableFilters.status !== "ALL" ||
    dateFilterMode !== "TODAY";

  const tableColumnCount = showActionsColumn ? 14 : 13;

  return (
    <div className="docf-page">
      <div className="docf-card">
        <div className="docf-card-header">
          <div>
            <h2 className="docf-title">{isSummary ? "Document" : `${safeSelectedType} Document`}</h2>
          </div>
          <ExcelUpload onUploaded={loadRows} />
        </div>

        <form onSubmit={handleSubmit} className="docf-form">
          <div className="docf-grid">

            <div className="docf-field">
              <label>Division</label>
              <select
                name="divisionNo"
                value={formData.divisionNo}
                onChange={handleDivisionChange}
                className="docf-input"
                disabled={divisionsLoading}
              >
                <option value="">-- Select Division --</option>
                {divisions.map(d => (
                  <option key={d.id ?? d.divisionNo} value={d.divisionNo}>
                    {d.divisionNo} — {d.divisionName}
                  </option>
                ))}
              </select>
            </div>

            <div className="docf-field">
              <label>Job Type</label>
              <select
                name="jobType"
                value={formData.jobType}
                onChange={handleChange}
                className="docf-input"
                disabled={jobCategoriesLoading || !formData.divisionNo}
              >
                <option value="">
                  {formData.divisionNo ? "-- Select Job Type --" : "-- Select Division first --"}
                </option>
                {formData.jobType && !filteredJobTypes.some(c => c.categoryName === formData.jobType) && (
                  <option value={formData.jobType}>{formData.jobType}</option>
                )}
                {filteredJobTypes.map(cat => (
                  <option key={cat.id} value={cat.categoryName}>
                    {cat.categoryName}
                  </option>
                ))}
              </select>
            </div>

            <div className="docf-field">
              <label>Job WBS</label>
              <input
                type="text" name="jobWBS" placeholder="Job WBS"
                value={formData.jobWBS} onChange={handleChange} className="docf-input"
              />
            </div>

            <div className="docf-field">
              <label>Reservation No</label>
              <input
                type="text"
                name="reservationNo"
                placeholder="10 digit Reservation No"
                value={formData.reservationNo}
                onChange={handleChange}
                className={`docf-input ${fieldErrors.reservationNo ? "docf-input-error" : ""}`}
                inputMode="numeric"
                pattern="\d*"
                maxLength={RESERVATION_NO_LENGTH}
              />
              {fieldErrors.reservationNo && (
                <span className="docf-field-error">{fieldErrors.reservationNo}</span>
              )}
            </div>

            <div className="docf-field">
              <label>Customer Name</label>
              <input
                type="text" name="customerName" placeholder="Customer Name"
                value={formData.customerName} onChange={handleChange} className="docf-input"
              />
            </div>

            <div className="docf-field">
              <label>Entered By</label>
              <select
                name="enteredBy"
                value={formData.enteredBy}
                onChange={handleChange}
                className="docf-input"
                disabled={enteredByLoading || !formData.divisionNo}
              >
                <option value="">
                  {formData.divisionNo ? "-- Select Entered By --" : "-- Select Division first --"}
                </option>
                {formData.enteredBy && !filteredEnteredBy.some(u => (u.operatorNicName || u.name || u.fullName || u.operatorName) === formData.enteredBy) && (
                  <option value={formData.enteredBy}>{formData.enteredBy}</option>
                )}
                {filteredEnteredBy.map(u => {
                  const label = u.operatorNicName || u.name || u.fullName || u.operatorName || "";
                  return (
                    <option key={u.id} value={label}>
                      {label}{u.nic ? ` — ${u.nic}` : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="docf-field">
              <label>Requested By</label>
              <input
                type="text" name="requestedBy" placeholder="Requested By"
                value={formData.requestedBy} onChange={handleChange} className="docf-input"
              />
            </div>

            <div className="docf-field">
              <label>Request Vehicle No <span className="docf-optional">(optional)</span></label>
              <input
                type="text" name="vehicleNo" placeholder="Vehicle No"
                value={formData.vehicleNo} onChange={handleChange} className="docf-input"
              />
            </div>

            <div className="docf-field">
              <label>SAP Issue Line No <span className="docf-optional">(optional)</span></label>
              <input
                type="text" name="sapIssueLineNo" placeholder="SAP Issue Line No"
                value={formData.sapIssueLineNo} onChange={handleChange} className="docf-input"
              />
            </div>

            <div className="docf-field">
              <label>Request Date</label>
              <input
                type="date" name="requestDate"
                value={formData.requestDate} onChange={handleChange} className="docf-input"
              />
            </div>

            <div className="docf-field">
              <label>Request Time</label>
              <input
                type="time"
                name="requestTime"
                step="60"
                value={formData.requestTime}
                onChange={handleChange}
                className="docf-input"
              />
            </div>

            <div className="docf-field">
              <label>Status</label>
              <input type="text" value={formData.status} readOnly className="docf-input docf-input-readonly docf-status-input" />
            </div>

          </div>

          {saveMsg && (
            <div className={`docf-message ${saveMsg.type === "error" ? "error" : "ok"}`}>
              {saveMsg.text}
            </div>
          )}

          <div className="docf-form-actions">
            <button type="submit" className="docf-btn docf-btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Update Document" : "Save Document"}
            </button>
            {editingId && (
              <button type="button" className="docf-btn docf-btn-ghost" onClick={cancelEdit}>
                Cancel Edit
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="docf-card">
        <div className="docf-table-header">
          <h3 className="docf-table-title">
            All Documents ({filteredRows.length}{filteredRows.length !== scopedRows.length ? ` of ${scopedRows.length}` : ""})
          </h3>
        </div>

        {/* ── Date filter — Today (Sri Lanka time, default) / All / Custom
            range. Same toolbar pattern as Check Portal / Print Portal /
            Pick Portal. ── */}
        <div className="docf-table-filterbar" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          {DATE_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              className="docf-btn docf-btn-ghost"
              style={{
                fontWeight: dateFilterMode === opt.value ? 700 : 500,
                borderColor: dateFilterMode === opt.value ? "#3b82f6" : undefined,
                color: dateFilterMode === opt.value ? "#3b82f6" : undefined,
              }}
              onClick={() => setDateFilterMode(opt.value)}
            >
              {opt.label}
            </button>
          ))}

          {dateFilterMode === "CUSTOM" && (
            <>
              <input
                type="date"
                className="docf-input"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                style={{ maxWidth: 160 }}
              />
              <span>—</span>
              <input
                type="date"
                className="docf-input"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                style={{ maxWidth: 160 }}
              />
              {(fromDate || toDate) && (
                <button
                  type="button"
                  className="docf-btn docf-btn-ghost"
                  onClick={() => { setFromDate(""); setToDate(""); }}
                >
                  ✕ Clear
                </button>
              )}
            </>
          )}
        </div>

        <div className="docf-table-filterbar">
          <input
            type="text"
            className="docf-search"
            placeholder="Search any column (id, WBS, reservation, customer, entered by, vehicle...)"
            value={tableFilters.search}
            onChange={e => handleTableFilterChange("search", e.target.value)}
          />

          <select
            className="docf-input"
            value={tableFilters.jobType}
            onChange={e => handleTableFilterChange("jobType", e.target.value)}
            style={{ maxWidth: 200 }}
          >
            <option value="ALL">All Job Types</option>
            {rowJobTypeOptions.map(jt => (
              <option key={jt} value={jt}>{jt}</option>
            ))}
          </select>

          <select
            className="docf-input"
            value={tableFilters.divisionNo}
            onChange={e => handleTableFilterChange("divisionNo", e.target.value)}
            style={{ maxWidth: 220 }}
          >
            <option value="ALL">All Divisions</option>
            {divisions.map(d => (
              <option key={d.id ?? d.divisionNo} value={d.divisionNo}>
                {d.divisionNo} — {d.divisionName}
              </option>
            ))}
          </select>

          <select
            className="docf-input"
            value={tableFilters.status}
            onChange={e => handleTableFilterChange("status", e.target.value)}
            style={{ maxWidth: 200 }}
          >
            <option value="ALL">All Status</option>
            {rowStatusOptions.map(st => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>

          {hasActiveTableFilters && (
            <button type="button" className="docf-btn docf-btn-ghost" onClick={() => { clearTableFilters(); setDateFilterMode("TODAY"); setFromDate(""); setToDate(""); }}>
              ✕ Clear filters
            </button>
          )}
        </div>

        {duplicateCount > 0 && (
          <div
            style={{
              background: "rgba(239,68,68,0.12)",
              border: "1px solid #ef4444",
              borderRadius: 8,
              padding: "8px 14px",
              marginBottom: 10,
              color: "#ef4444",
              fontWeight: 600,
              fontSize: "0.85rem",
            }}
          >
            ⚠ {duplicateCount} row{duplicateCount > 1 ? "s" : ""} are exact duplicates of an earlier row (every column, including Request Date &amp; Time, matches) — the original is highlighted green, the duplicate(s) red.
          </div>
        )}

        {rowsLoading && <div className="docf-status-text">Loading…</div>}
        {rowsError && <div className="docf-message error">{rowsError}</div>}

        {!rowsLoading && !rowsError && (
          <div className="docf-table-wrap">
            <table className="docf-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Job Type</th>
                  <th>Division</th>
                  <th>WBS</th>
                  <th>Reservation No</th>
                  <th>Customer</th>
                  <th>Entered By</th>
                  <th>Requested By</th>
                  <th>Vehicle No</th>
                  <th>SAP Line No</th>
                  <th>Request Date</th>
                  <th>Request Time</th>
                  <th>Status</th>
                  {showActionsColumn && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={tableColumnCount} className="docf-empty-row">No documents match this filter</td></tr>
                ) : filteredRows.map(row => {
                  const highlight = rowHighlightMap[row.id]; // "first" | "duplicate" | undefined
                  const rowStyle =
                    highlight === "duplicate"
                      ? { background: "rgba(239,68,68,0.14)", color: "#ef4444" }
                      : highlight === "first"
                      ? { background: "rgba(52,211,153,0.14)", color: "#16a34a" }
                      : undefined;
                  return (
                    <tr
                      key={row.id}
                      className={
                        highlight === "duplicate"
                          ? "docf-row-duplicate"
                          : highlight === "first"
                          ? "docf-row-duplicate-original"
                          : ""
                      }
                      style={rowStyle}
                    >
                      <td>{row.id}</td>
                      <td>{row.jobType}</td>
                      <td>{row.divisionNo ? `${row.divisionNo} — ${divisionNoToName[row.divisionNo] || ""}` : "—"}</td>
                      <td>{row.jobwbs || row.jobWBS || "—"}</td>
                      <td>{row.reservationNo || "—"}</td>
                      <td>{row.customerName || "—"}</td>
                      <td>{row.enteredBy || "—"}</td>
                      <td>{row.requestedBy || "—"}</td>
                      <td>{row.vehicleNo || "—"}</td>
                      <td>{row.sapIssueLineNo || "—"}</td>
                      <td>{row.requestDate || "—"}</td>
                      <td>{row.requestTime || "—"}</td>
                      <td><span className="docf-badge">{row.status || "Draft"}</span></td>
                      {showActionsColumn && (
                        <td className="docf-actions-cell">
                          {canEdit && (
                            <button className="docf-edit-btn" onClick={() => startEdit(row)}>Edit</button>
                          )}
                          {canDelete && (
                            <button className="docf-del-btn" onClick={() => removeRow(row.id)}>Delete</button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentForm;
