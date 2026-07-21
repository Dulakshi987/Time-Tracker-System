import { useState, useEffect, useCallback, useMemo } from "react";
import ExcelUpload from "./ExcelUpload";
import {
  createDocument,
  updateDocument,
  deleteDocument,
  fetchDocumentsByType,
  fetchAllDocuments,
  fetchJobCategories,
  fetchEnteredByUsers,
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
  divisionNo: "", // NEW: division selected for this document
  requestDate: getCurrentDate(),
  requestTime: getCurrentTime(),
  status: "Draft",
});

const DocumentForm = ({ selectedType }) => {
  const safeSelectedType = selectedType || "Summary";
  const isSummary = safeSelectedType === "Summary" || safeSelectedType === "All";

  const [formData, setFormData] = useState(emptyForm(isSummary ? "" : safeSelectedType));
  const [editingId, setEditingId] = useState(null);

  const [jobCategories, setJobCategories] = useState([]);
  const [jobCategoriesLoading, setJobCategoriesLoading] = useState(true);

  const [enteredByOptions, setEnteredByOptions] = useState([]);
  const [enteredByLoading, setEnteredByLoading] = useState(true);

  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState(null);

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => {
    setFormData(emptyForm(isSummary ? "" : safeSelectedType));
    setEditingId(null);
    setSaveMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSelectedType]);

  useEffect(() => {
    setJobCategoriesLoading(true);
    fetchJobCategories()
      .then(res => setJobCategories(res.data || []))
      .catch(() => setJobCategories([]))
      .finally(() => setJobCategoriesLoading(false));
  }, []);

  useEffect(() => {
    setEnteredByLoading(true);
    fetchEnteredByUsers()
      .then(res => setEnteredByOptions(res.data || []))
      .catch(() => setEnteredByOptions([]))
      .finally(() => setEnteredByLoading(false));
  }, []);

  // NEW: unique list of divisions derived from job categories, for the
  // Division dropdown. Adjust `c.divisionName` below if your job category
  // objects use a different field name (e.g. c.divisionNo).
  const divisionOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    jobCategories.forEach(c => {
      const name = c.divisionName || c.divisionNo;
      if (name && !seen.has(name)) {
        seen.add(name);
        list.push(name);
      }
    });
    return list;
  }, [jobCategories]);

  // Auto-suggest division when Job Type changes — only for a NEW document
  // (not while editing an existing row, so we don't clobber its saved value).
  useEffect(() => {
    if (isSummary || editingId) return;
    const match = jobCategories.find(
      c => (c.categoryName || "").toLowerCase() === (formData.jobType || "").toLowerCase()
    );
    if (match) {
      const name = match.divisionName || match.divisionNo;
      if (name) setFormData(prev => ({ ...prev, divisionNo: name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.jobType, isSummary, jobCategories, editingId]);

  const effectiveType = formData.jobType || safeSelectedType;
  const effectiveIsSummary = !formData.jobType && isSummary;

  const loadRows = useCallback(() => {
    setRowsLoading(true);
    const req = effectiveIsSummary
      ? fetchAllDocuments()
      : fetchDocumentsByType(effectiveType);

    req
      .then(res => { setRows(res.data || []); setRowsError(null); })
      .catch(err => setRowsError(err.message || "Failed to load documents"))
      .finally(() => setRowsLoading(false));
  }, [effectiveType, effectiveIsSummary]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.jobType) {
      setSaveMsg({ type: "error", text: "Please select a Job Type before saving." });
      return;
    }

    setSaving(true);
    setSaveMsg(null);

    const payload = {
      ...formData,
      jobType: formData.jobType,
      divisionNo: formData.divisionNo, // NEW: send selected division to backend
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
      divisionNo: row.divisionNo || "", // NEW: load saved division for edit
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

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.trim().toLowerCase();
    return rows.filter(r => {
      const hay = `${r.id} ${r.jobwbs || r.jobWBS || ""} ${r.reservationNo || ""} ${r.customerName || ""} ${r.requestedBy || ""} ${r.vehicleNo || ""}`.toLowerCase();
      return hay.includes(s);
    });
  }, [rows, search]);

  const tableTitle = effectiveIsSummary ? "All Documents" : `${effectiveType} Documents`;

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
              <label>Job Type</label>
              <select
                name="jobType"
                value={formData.jobType}
                onChange={handleChange}
                className="docf-input"
                disabled={jobCategoriesLoading}
              >
                <option value="">-- Select Job Type --</option>
                {formData.jobType && !jobCategories.some(c => c.categoryName === formData.jobType) && (
                  <option value={formData.jobType}>{formData.jobType}</option>
                )}
                {jobCategories.map(cat => (
                  <option key={cat.id} value={cat.categoryName}>
                    {cat.categoryName}
                  </option>
                ))}
              </select>
            </div>

            {/* NEW: Division dropdown */}
            <div className="docf-field">
              <label>Division</label>
              <select
                name="divisionNo"
                value={formData.divisionNo}
                onChange={handleChange}
                className="docf-input"
                disabled={jobCategoriesLoading}
              >
                <option value="">-- Select Division --</option>
                {formData.divisionNo && !divisionOptions.includes(formData.divisionNo) && (
                  <option value={formData.divisionNo}>{formData.divisionNo}</option>
                )}
                {divisionOptions.map(name => (
                  <option key={name} value={name}>{name}</option>
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
                disabled={enteredByLoading}
              >
                <option value="">-- Select Entered By --</option>
                {formData.enteredBy && !enteredByOptions.some(u => (u.name || u.fullName || u.operatorName) === formData.enteredBy) && (
                  <option value={formData.enteredBy}>{formData.enteredBy}</option>
                )}
                {enteredByOptions.map(u => {
                  const label = u.name || u.fullName || u.operatorName || "";
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
                type="time" name="requestTime"
                value={formData.requestTime} onChange={handleChange} className="docf-input"
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
            {tableTitle} ({filteredRows.length})
          </h3>
          <input
            type="text" className="docf-search" placeholder="Search WBS / reservation / customer / id…"
            value={search} onChange={e => setSearch(e.target.value)}
          />
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
                  <tr><td colSpan={14} className="docf-empty-row">No documents yet</td></tr>
                ) : filteredRows.map(row => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.jobType}</td>
                    <td>{row.divisionNo || "—"}</td>
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