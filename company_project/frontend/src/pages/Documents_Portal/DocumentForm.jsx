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
import "./DocumentsForm.css";

const getCurrentDate = () => new Date().toISOString().split("T")[0];
const getCurrentTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

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

const DocumentForm = ({ selectedType }) => {
  const safeSelectedType = selectedType || "Summary";
  const isSummary = safeSelectedType === "Summary" || safeSelectedType === "All";

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

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => {
    setFormData(emptyForm(isSummary ? "" : safeSelectedType));
    setEditingId(null);
    setSaveMsg(null);
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

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.divisionNo) {
      setSaveMsg({ type: "error", text: "Please select a Division before saving." });
      return;
    }

    if (!formData.jobType) {
      setSaveMsg({ type: "error", text: "Please select a Job Type before saving." });
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
      loadRows();
    } catch (error) {
      setSaveMsg({ type: "error", text: error?.response?.data || error.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
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
    setFormData(emptyForm(isSummary ? "" : safeSelectedType));
  };

  const removeRow = async (id) => {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    try {
      await deleteDocument(id);
      loadRows();
    } catch (error) {
      alert(error?.response?.data || error.message || "Delete failed");
    }
  };

  const rowJobTypeOptions = useMemo(() => {
    const set = new Set();
    rows.forEach(r => { if (r.jobType) set.add(r.jobType); });
    return Array.from(set).sort();
  }, [rows]);

  const rowStatusOptions = useMemo(() => {
    const set = new Set();
    rows.forEach(r => { if (r.status) set.add(r.status); });
    return Array.from(set).sort();
  }, [rows]);

  const handleTableFilterChange = (field, value) => {
    setTableFilters(prev => ({ ...prev, [field]: value }));
  };

  const clearTableFilters = () => setTableFilters(emptyTableFilters());

  const filteredRows = useMemo(() => {
    const s = tableFilters.search.trim().toLowerCase();

    return rows.filter(row => {
      if (tableFilters.jobType !== "ALL" && (row.jobType || "") !== tableFilters.jobType) return false;
      if (tableFilters.divisionNo !== "ALL" && (row.divisionNo || "") !== tableFilters.divisionNo) return false;
      if (tableFilters.status !== "ALL" && (row.status || "Draft") !== tableFilters.status) return false;

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
  }, [rows, tableFilters, divisionNoToName]);

  const hasActiveTableFilters =
    tableFilters.search.trim() !== "" ||
    tableFilters.jobType !== "ALL" ||
    tableFilters.divisionNo !== "ALL" ||
    tableFilters.status !== "ALL";

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
                type="text" name="reservationNo" placeholder="Reservation No"
                value={formData.reservationNo} onChange={handleChange} className="docf-input"
              />
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
              <div className="docf-time-row">
                <input
                  type="time"
                  name="requestTime"
                  step="60"
                  value={formData.requestTime}
                  onChange={handleChange}
                  className="docf-input"
                />
                <button
                  type="button"
                  className="docf-btn docf-btn-ghost docf-time-now-btn"
                  onClick={() =>
                    setFormData(prev => ({ ...prev, requestTime: getCurrentTime() }))
                  }
                >
                  Now
                </button>
              </div>
              <span className="docf-time-digital">{formData.requestTime || "--:--"}</span>
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
            All Documents ({filteredRows.length}{filteredRows.length !== rows.length ? ` of ${rows.length}` : ""})
          </h3>
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
            className="docf-input docf-table-filter-select"
            value={tableFilters.jobType}
            onChange={e => handleTableFilterChange("jobType", e.target.value)}
          >
            <option value="ALL">All Job Types</option>
            {rowJobTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select
            className="docf-input docf-table-filter-select"
            value={tableFilters.divisionNo}
            onChange={e => handleTableFilterChange("divisionNo", e.target.value)}
          >
            <option value="ALL">All Divisions</option>
            {divisions.map(d => (
              <option key={d.id ?? d.divisionNo} value={d.divisionNo}>
                {d.divisionNo} — {d.divisionName}
              </option>
            ))}
          </select>

          <select
            className="docf-input docf-table-filter-select"
            value={tableFilters.status}
            onChange={e => handleTableFilterChange("status", e.target.value)}
          >
            <option value="ALL">All Statuses</option>
            {rowStatusOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {hasActiveTableFilters && (
            <button type="button" className="docf-btn docf-btn-ghost" onClick={clearTableFilters}>
              ✕ Clear filters
            </button>
          )}
        </div>

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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr><td colSpan={14} className="docf-empty-row">No documents match this filter</td></tr>
                ) : filteredRows.map(row => (
                  <tr key={row.id}>
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
                    <td className="docf-actions-cell">
                      <button className="docf-edit-btn" onClick={() => startEdit(row)}>Edit</button>
                      <button className="docf-del-btn" onClick={() => removeRow(row.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentForm;