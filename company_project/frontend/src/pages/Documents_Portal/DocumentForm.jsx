import { useState, useEffect, useCallback, useMemo } from "react";
import ExcelUpload from "./ExcelUpload";
import {
  createDocument,
  updateDocument,
  deleteDocument,
  fetchDocumentsByType,
  fetchAllDocuments,
  fetchJobCategories,
  // NOTE: adjust this import to match whatever function your api.js actually
  // exports for the Admin → "Document/Print By" list (name + NIC). I've
  // named it fetchEnteredByUsers below — rename this import (and the call
  // site further down) to match your real service function/endpoint.
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
  requestDate: getCurrentDate(),
  requestTime: getCurrentTime(),
  status: "Draft",
});

const DocumentForm = ({ selectedType }) => {
  // Guard against the parent not passing selectedType yet (undefined/null on
  // first render, before Sidebar's category fetch resolves). Falling back to
  // "Summary" avoids calling fetchDocumentsByType(undefined), which is what
  // was causing "undefined Documents (0)" / "No documents yet" even though
  // rows exist in the DB.
  const safeSelectedType = selectedType || "Summary";
  const isSummary = safeSelectedType === "Summary" || safeSelectedType === "All";

  const [formData, setFormData] = useState(emptyForm(isSummary ? "" : safeSelectedType));
  const [editingId, setEditingId] = useState(null);

  const [division, setDivision] = useState(null);

  // Full list of job categories from Admin → Master Setup → Job Category,
  // used to populate the Job Type dropdown.
  const [jobCategories, setJobCategories] = useState([]);
  const [jobCategoriesLoading, setJobCategoriesLoading] = useState(true);

  // "Entered By" people, set up in Admin → Master Setup → Document/Print By
  // (name + NIC). Used to populate the Entered By dropdown.
  const [enteredByOptions, setEnteredByOptions] = useState([]);
  const [enteredByLoading, setEnteredByLoading] = useState(true);

  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState(null);

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  // Reset the form (and cancel any in-progress edit) whenever the
  // selected job category changes.
  useEffect(() => {
    setFormData(emptyForm(isSummary ? "" : safeSelectedType));
    setEditingId(null);
    setSaveMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSelectedType]);

  // Load all job categories once, for the Job Type dropdown.
  useEffect(() => {
    setJobCategoriesLoading(true);
    fetchJobCategories()
      .then(res => setJobCategories(res.data || []))
      .catch(() => setJobCategories([]))
      .finally(() => setJobCategoriesLoading(false));
  }, []);

  // Load the "Document/Print By" people list once, for the Entered By
  // dropdown. Rename fetchEnteredByUsers (import + here) to your real
  // service function if it's called something else.
  useEffect(() => {
    setEnteredByLoading(true);
    fetchEnteredByUsers()
      .then(res => setEnteredByOptions(res.data || []))
      .catch(() => setEnteredByOptions([]))
      .finally(() => setEnteredByLoading(false));
  }, []);

  // Look up which division the currently selected job type belongs to.
  useEffect(() => {
    if (isSummary) { setDivision(null); return; }
    const match = jobCategories.find(
      c => (c.categoryName || "").toLowerCase() === (formData.jobType || "").toLowerCase()
    );
    setDivision(match ? match.divisionName : null);
  }, [formData.jobType, isSummary, jobCategories]);

  // Which type actually drives the table: the form's own Job Type dropdown
  // takes priority (so picking a type there filters the table below), and
  // only falls back to the sidebar's selectedType/Summary when the dropdown
  // is empty.
  const effectiveType = formData.jobType || safeSelectedType;
  const effectiveIsSummary = !formData.jobType && isSummary;

  // Load the table of existing documents for the effective job type
  // (or every document, when nothing specific is selected). Guarded so it
  // never fires with an invalid/undefined type.
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
      // Always send whatever is actually selected in the Job Type dropdown,
      // not the sidebar's (possibly stale/undefined) selectedType.
      jobType: formData.jobType,
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
              {division && <div className="docf-division-pill">Division: {division}</div>}
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
                  {/* keep current value selectable even if it's not (yet) in the fetched list */}
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
                  {/* keep current value selectable even if it's not (yet) in the fetched list */}
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
                  <tr><td colSpan={13} className="docf-empty-row">No documents yet</td></tr>
                ) : filteredRows.map(row => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.jobType}</td>
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
