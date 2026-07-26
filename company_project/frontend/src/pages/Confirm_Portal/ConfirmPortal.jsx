import { useState, useEffect, useCallback, useMemo } from "react";
import "./ConfirmPortal.css";

// const DELIVERY_API = "http://localhost:8080/api/delivery-portal";
// const CONFIRM_API = "http://localhost:8080/api/issue-confirm";
// const SETUP_API = "http://localhost:8080/api/admin-setup";

const DELIVERY_API = "https://time-tracker-system-production.up.railway.app/api/delivery-portal";
const CONFIRM_API = "https://time-tracker-system-production.up.railway.app/api/issue-confirm";
const SETUP_API = "https://time-tracker-system-production.up.railway.app/api/admin-setup";
const AUTO_REFRESH = 10000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d) { return d || "—"; }
function formatTime(t) { return t ? String(t).substring(0, 5) : "—"; }

function formatDateTime(dt) {
  if (!dt) return "—";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function yn(v) {
  if (v === true || v === "YES" || v === "Yes" || v === "yes") return "Yes";
  if (v === false || v === "NO" || v === "No" || v === "no") return "No";
  return v || "—";
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
  if (v.includes("cancel"))   return "cancelled";
  if (v.includes("hold"))     return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("complete") || v.includes("done")) return "completed";
  return "pending";
}

function statusLabel(sc) {
  if (sc === "completed") return "Delivered";
  if (sc === "onhold")    return "Hold";
  if (sc === "cancelled") return "Cancelled";
  return sc;
}

function displayStatus(doc) {
  if (doc.fileNumber) return { label: "Filed", cls: "filed" };
  const sc = statusClass(doc.deliveryStatus);
  return { label: statusLabel(sc), cls: sc };
}

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

function eventInfo(doc) {
  const sc = statusClass(doc.deliveryStatus);
  if (sc === "completed") {
    return { dateTime: doc.deliveryEndTime, by: doc.deliveredBy, reason: null };
  }
  if (sc === "cancelled") {
    return { dateTime: doc.deliveryCancelTime, by: doc.deliveryCancelledBy, reason: doc.deliveryCancelReason };
  }
  return { dateTime: null, by: null, reason: null };
}

async function fetchActiveFileNumber() {
  const res = await fetch(`${SETUP_API}/file-numbers`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const list = await res.json();
  const active = list.find(f => f.active === true || f.active === "true");
  return active ? active.fileNo : null;
}

// ── Add to File popup ───────────────────────────────────────────────────────

function AddFilePopup({ doc, reqId, activeFileNo, loadingFileNo, fileNoError, onConfirm, onCancel }) {
  const canConfirm = !!activeFileNo && !loadingFileNo;

  return (
    <div className="icf-popup-overlay">
      <div className="icf-popup">
        <div className="icf-popup-head">
          <span>📁 Add to File</span>
          <button className="icf-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="icf-popup-sub">
          {doc.printDocumentNo || `Doc #${doc.id}`} (Req ID: {reqId || "—"}) සඳහා
          admin විසින් setup කළ active file number එක auto-fill වේ
        </p>

        <div className="icf-popup-field">
          <span className="icf-popup-label">Active File Number</span>
          <input
            className="icf-popup-text-input"
            type="text"
            value={loadingFileNo ? "Loading..." : (activeFileNo || "")}
            readOnly
            placeholder="No active file number set by admin"
          />
        </div>

        {!loadingFileNo && fileNoError && (
          <div className="icf-error" style={{ marginTop: 8 }}>
            ⚠ Could not load active file number: {fileNoError}
          </div>
        )}
        {!loadingFileNo && !fileNoError && !activeFileNo && (
          <div className="icf-error" style={{ marginTop: 8 }}>
            ⚠ Admin has not marked any file number as Active yet in Master Setup → Document File No.
          </div>
        )}

        <div className="icf-popup-foot">
          <button className="icf-btn icf-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="icf-btn-done"
            disabled={!canConfirm}
            onClick={() => onConfirm(activeFileNo)}
          >
            📁 Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit / Delete File popup ────────────────────────────────────────────────

function FileEditPopup({ doc, editValue, onEditValueChange, saving, onSave, onDelete, onCancel }) {
  return (
    <div className="icf-popup-overlay">
      <div className="icf-popup">
        <div className="icf-popup-head">
          <span>📁 Edit File Number</span>
          <button className="icf-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="icf-popup-sub">
          {doc.printDocumentNo || `Doc #${doc.id}`} — currently filed as{" "}
          <strong>{doc.fileNumber}</strong>
        </p>

        <div className="icf-popup-field">
          <span className="icf-popup-label">File Number</span>
          <input
            className="icf-popup-text-input"
            type="text"
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            placeholder="Enter file number"
            disabled={saving}
          />
        </div>

        <div className="icf-popup-foot">
          <button className="icf-btn-danger" disabled={saving} onClick={onDelete}>
            🗑 Delete
          </button>
          <div style={{ flex: 1 }} />
          <button className="icf-btn icf-btn-outline" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="icf-btn-done"
            disabled={saving || !editValue.trim()}
            onClick={onSave}
          >
            {saving ? "Saving..." : "✓ Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit / Delete Status popup ──────────────────────────────────────────────

function StatusEditPopup({ doc, fields, onFieldChange, saving, onSave, onDelete, onCancel }) {
  const sc = statusClass(doc.deliveryStatus);
  const isDelivered = sc === "completed";

  return (
    <div className="icf-popup-overlay">
      <div className="icf-popup">
        <div className="icf-popup-head">
          <span>{isDelivered ? "🚚 Edit Delivered Details" : "✕ Edit Cancelled Details"}</span>
          <button className="icf-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="icf-popup-sub">
          {doc.printDocumentNo || `Doc #${doc.id}`}
        </p>

        {isDelivered ? (
          <div className="icf-popup-field">
            <span className="icf-popup-label">Delivered By</span>
            <input
              className="icf-popup-text-input"
              type="text"
              value={fields.deliveredBy}
              onChange={e => onFieldChange("deliveredBy", e.target.value)}
              placeholder="Enter name"
              disabled={saving}
            />
          </div>
        ) : (
          <>
            <div className="icf-popup-field">
              <span className="icf-popup-label">Cancelled By</span>
              <input
                className="icf-popup-text-input"
                type="text"
                value={fields.deliveryCancelledBy}
                onChange={e => onFieldChange("deliveryCancelledBy", e.target.value)}
                placeholder="Enter name"
                disabled={saving}
              />
            </div>
            <div className="icf-popup-field">
              <span className="icf-popup-label">Cancel Reason</span>
              <input
                className="icf-popup-text-input"
                type="text"
                value={fields.deliveryCancelReason}
                onChange={e => onFieldChange("deliveryCancelReason", e.target.value)}
                placeholder="Enter reason"
                disabled={saving}
              />
            </div>
          </>
        )}

        <div className="icf-popup-foot">
          <button className="icf-btn-danger" disabled={saving} onClick={onDelete}>
            🗑 Delete Document
          </button>
          <div style={{ flex: 1 }} />
          <button className="icf-btn icf-btn-outline" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button className="icf-btn-done" disabled={saving} onClick={onSave}>
            {saving ? "Saving..." : "✓ Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View Drawer helpers ─────────────────────────────────────────────────────

function DetailRow({ label, value }) {
  return (
    <div className="icf-detail-row">
      <span className="icf-detail-label">{label}</span>
      <span className="icf-detail-value">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

function Section({ icon, title, children, accent }) {
  return (
    <div className={`icf-view-section ${accent ? `accent-${accent}` : ""}`}>
      <div className="icf-view-section-head">{icon} {title}</div>
      <div className="icf-view-section-body">{children}</div>
    </div>
  );
}

function ViewDrawer({ doc, reqId, onClose }) {
  const ds = displayStatus(doc);

  return (
    <div className="icf-drawer-overlay" onClick={onClose}>
      <div className="icf-drawer" onClick={e => e.stopPropagation()}>
        <div className="icf-drawer-head">
          <div>
            <span className="icf-drawer-title">📄 {doc.printDocumentNo ? doc.printDocumentNo : `Doc #${doc.id}`}</span>
            <span className={`icf-badge ${ds.cls}`} style={{ marginLeft: 10 }}>{ds.label}</span>
          </div>
          <button className="icf-popup-close" onClick={onClose}>✕</button>
        </div>

        <div className="icf-drawer-body">
          <Section icon="📝" title="Request Details">
            <DetailRow label="Req ID" value={doc.reqId || reqId} />
            <DetailRow label="Customer" value={doc.customerName} />
            <DetailRow label="Job Type" value={
              <span style={{ color: jobTypeColor(doc.jobType), fontWeight: 700 }}>{doc.jobType || "—"}</span>
            } />
            <DetailRow label="Job / WBS" value={doc.jobwbs} />
            <DetailRow label="Reservation No" value={doc.reservationNo} />
            <DetailRow label="Request Date" value={formatDate(doc.requestDate)} />
            <DetailRow label="Request Time" value={formatTime(doc.requestTime)} />
            <DetailRow label="Requested By" value={doc.requestedBy} />
            <DetailRow label="Request Vehicle No" value={doc.vehicleNo ? `🚐 ${doc.vehicleNo}` : "—"} />
            <DetailRow label="Entered By" value={doc.enteredBy} />
            <DetailRow label="Entered Date/Time" value={formatDateTime(doc.createdDatetime)} />
          </Section>

          <Section icon="🖨️" title="Print Details" accent="print">
            <DetailRow label="Print Status" value={doc.printStatus} />
            <DetailRow label="Print Document No" value={doc.printDocumentNo} />
            <DetailRow label="Printed By" value={doc.printedBy} />
            <DetailRow label="Print Start Time" value={formatDateTime(doc.printStartTime)} />
            <DetailRow label="Print End Time" value={formatDateTime(doc.printEndTime)} />
            <DetailRow label="Print Handover Time" value={formatDateTime(doc.printHandoverTime)} />
            <DetailRow label="Print Handed Over By" value={doc.PrintHandedOverBy} />
            {(doc.printHoldReason || doc.printHeldBy) && (
              <>
                <DetailRow label="Print Hold Reason" value={doc.printHoldReason} />
                <DetailRow label="Print Held By" value={doc.printHeldBy} />
                <DetailRow label="Print Hold Time" value={formatDateTime(doc.printHoldTime)} />
                <DetailRow label="Print Resume Time" value={formatDateTime(doc.printResumeTime)} />
              </>
            )}
          </Section>

          <Section icon="📦" title="Picking Details" accent="pick">
            <DetailRow label="Picked By" value={doc.pickedBy} />
            <DetailRow label="Pick Start Time" value={formatDateTime(doc.startTime)} />
            <DetailRow label="Pick End Time" value={formatDateTime(doc.endTime)} />
            {(doc.holdReason || doc.heldBy) && (
              <>
                <DetailRow label="Pick Hold Reason" value={doc.holdReason} />
                <DetailRow label="Pick Held By" value={doc.heldBy} />
                <DetailRow label="Pick Hold Time" value={formatDateTime(doc.holdTime)} />
                <DetailRow label="Pick Resume Time" value={formatDateTime(doc.resumeTime)} />
              </>
            )}
            {doc.emergencyPickResolved !== undefined && doc.emergencyPickResolved !== null && (
              <>
                <DetailRow label="Emergency Pick Resolved" value={yn(doc.emergencyPickResolved)} />
                <DetailRow label="Resolved By" value={doc.emergencyPickResolvedBy} />
                <DetailRow label="Resolved Time" value={formatDateTime(doc.emergencyResolvedTime)} />
              </>
            )}
          </Section>

          <Section icon="✅" title="Check Details" accent="check">
            <DetailRow label="Checked By" value={doc.checkedBy} />
            <DetailRow label="Check Start Time" value={formatDateTime(doc.checkStartTime)} />
            <DetailRow label="Check End Time" value={formatDateTime(doc.checkEndTime)} />
            {(doc.checkHoldReason || doc.checkHeldBy) && (
              <>
                <DetailRow label="Check Hold Reason" value={doc.checkHoldReason} />
                <DetailRow label="Check Held By" value={doc.checkHeldBy} />
                <DetailRow label="Check Hold Time" value={formatDateTime(doc.checkHoldTime)} />
                <DetailRow label="Check Resume Time" value={formatDateTime(doc.checkResumeTime)} />
              </>
            )}
            <div className="icf-view-subhead">⚠ Picking Error</div>
            <DetailRow label="Wrong Material" value={yn(doc.hasWrongMaterial)} />
            {(doc.hasWrongMaterial === "YES" || doc.hasWrongMaterial === true) && (
              <>
                <DetailRow label="Wrong Material SKU" value={doc.wrongMaterialSku} />
                <DetailRow label="Wrong Material Qty" value={doc.wrongMaterialQty} />
              </>
            )}
          </Section>

          <Section icon="🚚" title="Delivery Details" accent="delivery">
            <DetailRow label="Delivery Status" value={statusLabel(statusClass(doc.deliveryStatus))} />
            <DetailRow label="Delivery Start Time" value={formatDateTime(doc.deliveryStartTime)} />
            <DetailRow label="Delivery End Time" value={formatDateTime(doc.deliveryEndTime)} />
            <DetailRow label="Delivered By" value={doc.deliveredBy} />
            <DetailRow label="Delivery Vehicle No" value={doc.deliveryVehicleNo ? `🚐 ${doc.deliveryVehicleNo}` : "—"} />
            <DetailRow label="Delivery Confirmed" value={yn(doc.deliveryConfirmed)} />
            <DetailRow label="Delivery Confirmed By" value={doc.deliveryConfirmedBy} />
            <DetailRow label="Delivery Confirm Time" value={formatDateTime(doc.deliveryConfirmTime)} />
          </Section>

          {doc.deliveryCancelReason && (
            <Section icon="✕" title="Delivery Cancelled" accent="cancel">
              <DetailRow label="Cancel Reason" value={doc.deliveryCancelReason} />
              <DetailRow label="Cancelled By" value={doc.deliveryCancelledBy} />
              <DetailRow label="Cancelled At" value={formatDateTime(doc.deliveryCancelTime)} />
              <DetailRow label="Cancel Confirmed" value={yn(doc.cancelConfirmed)} />
              <DetailRow label="Cancel Confirmed By" value={doc.cancelConfirmedBy} />
              <DetailRow label="Cancel Confirm Time" value={formatDateTime(doc.cancelConfirmTime)} />
            </Section>
          )}

          <Section icon="📁" title="File Details" accent="file">
            <DetailRow label="Req ID" value={doc.reqId || reqId} />
            <DetailRow label="File Number" value={doc.fileNumber ? `📁 ${doc.fileNumber}` : "Not yet added to file"} />
          </Section>
        </div>

        <div className="icf-popup-foot">
          <button className="icf-drawer-close-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function IssueConfirm() {
  const [documents,   setDocuments]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [search,      setSearch]      = useState("");
  const [savingId,    setSavingId]    = useState(null);
  const [viewDoc,     setViewDoc]     = useState(null);

  // Add-to-File popup
  const [fileDoc,       setFileDoc]       = useState(null);
  const [activeFileNo,  setActiveFileNo]  = useState(null);
  const [loadingFileNo, setLoadingFileNo] = useState(false);
  const [fileNoError,   setFileNoError]   = useState(null);

  // Edit/Delete FILE popup
  const [editFileDoc,      setEditFileDoc]      = useState(null);
  const [editFileValue,    setEditFileValue]    = useState("");
  const [fileActionSaving, setFileActionSaving] = useState(false);

  // Edit/Delete STATUS popup
  const [editStatusDoc,      setEditStatusDoc]      = useState(null);
  const [statusFields,       setStatusFields]       = useState({ deliveredBy: "", deliveryCancelledBy: "", deliveryCancelReason: "" });
  const [statusActionSaving, setStatusActionSaving] = useState(false);

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(DELIVERY_API);
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

  const reqIdMap = useMemo(() => computeRequestIds(documents), [documents]);

  // Only Delivered + Cancelled
  const relevant = documents.filter(d => ["completed", "cancelled"].includes(statusClass(d.deliveryStatus)));

  const visible = relevant.filter(doc => {
    const sc = statusClass(doc.deliveryStatus);
    const matchStatus = filterStatus === "ALL" || sc === filterStatus;

    const q = search.toLowerCase().trim();
    const reqId = (doc.reqId || reqIdMap[doc.id] || "").toLowerCase();
    const matchSearch = !q || [
      reqId,
      doc.printDocumentNo,
      doc.jobwbs,
      doc.customerName,
      doc.requestedBy,
      doc.deliveryVehicleNo,
      doc.deliveredBy,
      doc.deliveryCancelledBy,
      doc.fileNumber,
      String(doc.id),
    ].some(v => (v || "").toLowerCase().includes(q));

    return matchStatus && matchSearch;
  });

  const counts = {
    completed: relevant.filter(d => statusClass(d.deliveryStatus) === "completed").length,
    cancelled: relevant.filter(d => statusClass(d.deliveryStatus) === "cancelled").length,
  };

  useEffect(() => {
    if (!viewDoc) return;
    const fresh = documents.find(d => d.id === viewDoc.id);
    if (fresh) setViewDoc(fresh);
  }, [documents]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add to File ──
  const handleAddToFileClick = async (doc) => {
    setFileDoc(doc);
    setActiveFileNo(null);
    setFileNoError(null);
    setLoadingFileNo(true);
    try {
      const fno = await fetchActiveFileNumber();
      setActiveFileNo(fno);
    } catch (err) {
      setFileNoError(err.message);
    } finally {
      setLoadingFileNo(false);
    }
  };

  const closeFilePopup = () => {
    setFileDoc(null);
    setActiveFileNo(null);
    setFileNoError(null);
  };

  const handleAddToFileConfirm = async (fileNumber) => {
    const doc = fileDoc;
    if (!doc || !fileNumber) return;
    closeFilePopup();
    setSavingId(doc.id);
    try {
      const res = await fetch(`${CONFIRM_API}/${doc.id}/add-to-file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reqId: reqIdMap[doc.id], fileNumber }),
      });
      if (res.status === 409) {
        await fetchDocuments(true);
        return;
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const updated = await res.json();
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
    } catch (err) {
      alert("Add to File failed: " + err.message);
    } finally {
      setSavingId(null);
    }
  };

  // ── File Edit / Delete ──
  const openFileEdit = (doc) => {
    setEditFileDoc(doc);
    setEditFileValue(doc.fileNumber || "");
  };

  const closeFileEdit = () => {
    setEditFileDoc(null);
    setEditFileValue("");
  };

  const handleSaveFileEdit = async () => {
    if (!editFileDoc || !editFileValue.trim()) return;
    setFileActionSaving(true);
    try {
      const res = await fetch(`${CONFIRM_API}/${editFileDoc.id}/edit-file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileNumber: editFileValue.trim() }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const updated = await res.json();
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
      closeFileEdit();
    } catch (err) {
      alert("Edit failed: " + err.message);
    } finally {
      setFileActionSaving(false);
    }
  };

  const handleDeleteFileNumber = async () => {
    if (!editFileDoc) return;
    if (!window.confirm(`Remove file number ${editFileDoc.fileNumber}? This document will go back to "not filed".`)) return;
    setFileActionSaving(true);
    try {
      const res = await fetch(`${CONFIRM_API}/${editFileDoc.id}/file`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const updated = await res.json();
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
      closeFileEdit();
    } catch (err) {
      alert("Delete failed: " + err.message);
    } finally {
      setFileActionSaving(false);
    }
  };

  // ── Status Edit / Delete ──
  const openStatusEdit = (doc) => {
    setEditStatusDoc(doc);
    setStatusFields({
      deliveredBy: doc.deliveredBy || "",
      deliveryCancelledBy: doc.deliveryCancelledBy || "",
      deliveryCancelReason: doc.deliveryCancelReason || "",
    });
  };

  const closeStatusEdit = () => {
    setEditStatusDoc(null);
    setStatusFields({ deliveredBy: "", deliveryCancelledBy: "", deliveryCancelReason: "" });
  };

  const handleStatusFieldChange = (key, value) => {
    setStatusFields(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveStatusEdit = async () => {
    if (!editStatusDoc) return;
    const sc = statusClass(editStatusDoc.deliveryStatus);
    const body = sc === "completed"
      ? { deliveredBy: statusFields.deliveredBy }
      : { deliveryCancelledBy: statusFields.deliveryCancelledBy, deliveryCancelReason: statusFields.deliveryCancelReason };

    setStatusActionSaving(true);
    try {
      const res = await fetch(`${CONFIRM_API}/${editStatusDoc.id}/edit-status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const updated = await res.json();
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
      closeStatusEdit();
    } catch (err) {
      alert("Edit failed: " + err.message);
    } finally {
      setStatusActionSaving(false);
    }
  };

  const handleDeleteDocument = async (doc) => {
    const target = doc || editStatusDoc;
    if (!target) return;
    if (!window.confirm(`Permanently delete ${target.printDocumentNo || `Doc #${target.id}`}? This cannot be undone.`)) return;

    setStatusActionSaving(true);
    try {
      const res = await fetch(`${CONFIRM_API}/${target.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setDocuments(prev => prev.filter(d => d.id !== target.id));
      closeStatusEdit();
    } catch (err) {
      alert("Delete failed: " + err.message);
    } finally {
      setStatusActionSaving(false);
    }
  };

  // Manage column → Edit button
  const handleManageEdit = (doc) => {
    if (doc.fileNumber) {
      openFileEdit(doc);
    } else {
      openStatusEdit(doc);
    }
  };

  return (
    <div className="icf-page">

      {viewDoc && (
        <ViewDrawer
          doc={viewDoc}
          reqId={reqIdMap[viewDoc.id]}
          onClose={() => setViewDoc(null)}
        />
      )}

      {fileDoc && (
        <AddFilePopup
          doc={fileDoc}
          reqId={reqIdMap[fileDoc.id]}
          activeFileNo={activeFileNo}
          loadingFileNo={loadingFileNo}
          fileNoError={fileNoError}
          onConfirm={handleAddToFileConfirm}
          onCancel={closeFilePopup}
        />
      )}

      {editFileDoc && (
        <FileEditPopup
          doc={editFileDoc}
          editValue={editFileValue}
          onEditValueChange={setEditFileValue}
          saving={fileActionSaving}
          onSave={handleSaveFileEdit}
          onDelete={handleDeleteFileNumber}
          onCancel={closeFileEdit}
        />
      )}

      {editStatusDoc && (
        <StatusEditPopup
          doc={editStatusDoc}
          fields={statusFields}
          onFieldChange={handleStatusFieldChange}
          saving={statusActionSaving}
          onSave={handleSaveStatusEdit}
          onDelete={() => handleDeleteDocument(editStatusDoc)}
          onCancel={closeStatusEdit}
        />
      )}

      {/* Header */}
      <div className="ip-header">
        <div className="ip-header-left">
          <h1>LOGITRACK-WAREHOUSE TIME EFFICENCY TRACKER SYSTEM</h1>
          <h1>Issue Confirm Portal</h1>
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

      {/* Toolbar — Search + Filter */}
      <div className="icf-toolbar">
        <div className="icf-search-wrap" style={{ flex: 1, maxWidth: 420 }}>
          <span className="icf-search-icon">🔍</span>
          <input
            className="icf-search"
            type="text"
            placeholder="Search by Req ID, Doc No, WBS, Customer, Requested By, Vehicle, File No..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select
          className="icf-filter-select"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="ALL">All Status</option>
          <option value="completed">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <div className="icf-stats">
          <div className="icf-stat-chip completed">Delivered <strong>{counts.completed}</strong></div>
          <div className="icf-stat-chip cancelled">Cancelled <strong>{counts.cancelled}</strong></div>
          <div className="icf-stat-chip">Showing <strong style={{ color: "#a78bfa" }}>{visible.length}</strong></div>
        </div>
      </div>

      {error && (
        <div className="icf-error">
          ⚠ {error} — <button onClick={() => fetchDocuments(false)}>retry</button>
        </div>
      )}

      {/* Table */}
      <div className="icf-table-wrap">
        <table className="icf-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Req ID</th>
              <th>Doc No</th>
              <th>Requested By</th>
              <th>Delivery Vehicle</th>
              <th>Delivered By</th>
              <th>Cancelled By</th>
              <th>Date / Time</th>
              <th>Job Type</th>
              <th>View</th>
              <th>Manage</th>
              <th>File No.</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="icf-empty-cell">Loading...</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={12} className="icf-empty-cell">No documents found.</td></tr>
            ) : (
              visible.map(doc => {
                const sc = statusClass(doc.deliveryStatus);
                const info = eventInfo(doc);
                const ds = displayStatus(doc);
                const isFiled = !!doc.fileNumber;
                const reqId = doc.reqId || reqIdMap[doc.id] || "—";

                return (
                  <tr key={doc.id} className="icf-row">
                    {/* Status badge (clickable) */}
                    <td>
                      <span
                        className={`icf-badge ${ds.cls}`}
                        style={{ cursor: "pointer" }}
                        title="Click to edit or delete"
                        onClick={() => (isFiled ? openFileEdit(doc) : openStatusEdit(doc))}
                      >
                        {ds.label}
                      </span>
                    </td>

                    {/* Req ID */}
                    <td className="icf-td-reqid">{reqId}</td>

                    {/* Doc No */}
                    <td className="icf-td-docno">{doc.printDocumentNo || `Doc #${doc.id}`}</td>

                    {/* Requested By */}
                    <td>{doc.requestedBy || "—"}</td>

                    {/* Delivery Vehicle */}
                    <td>🚐 {doc.deliveryVehicleNo || "—"}</td>

                    {/* Delivered By */}
                    <td>{sc === "completed" ? `👤 ${info.by || "—"}` : "—"}</td>

                    {/* Cancelled By */}
                    <td>{sc === "cancelled" ? `👤 ${info.by || "—"}` : "—"}</td>

                    {/* Date / Time */}
                    <td className="icf-td-datetime">{formatDateTime(info.dateTime)}</td>

                    {/* Job Type */}
                    <td>
                      <span style={{ color: jobTypeColor(doc.jobType), fontWeight: 600 }}>
                        {doc.jobType || "—"}
                      </span>
                    </td>

                    {/* View */}
                    <td>
                      <button className="icf-btn-view" onClick={() => setViewDoc(doc)}>
                        👁 View
                      </button>
                    </td>

                    {/* Manage — Edit + Delete (same style as Delivery Portal) */}
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          className="icf-mini-manage"
                          title="Edit"
                          onClick={() => handleManageEdit(doc)}
                          style={{
                            backgroundColor: "#3b82f6",
                            color: "#eaf2ff",
                            border: "1px solid #3b82f6",
                            minWidth: 34,
                            minHeight: 34,
                            fontSize: "1.05rem",
                            borderRadius: 8,
                            cursor: "pointer",
                          }}
                        >
                          ✎
                        </button>
                        <button
                          className="icf-mini-manage"
                          title="Delete"
                          onClick={() => handleDeleteDocument(doc)}
                          style={{
                            backgroundColor: "#ef4444",
                            color: "#2a0a0a",
                            border: "1px solid #ef4444",
                            minWidth: 34,
                            minHeight: 34,
                            fontSize: "1.05rem",
                            borderRadius: 8,
                            cursor: "pointer",
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    </td>

                    {/* File No */}
                    <td>
                      {doc.fileNumber ? (
                        <span
                          className="icf-filenum"
                          style={{ cursor: "pointer" }}
                          title="Click to edit or delete this file entry"
                          onClick={() => openFileEdit(doc)}
                        >
                          📁 {doc.fileNumber}
                        </span>
                      ) : (
                        <button
                          className="icf-btn-addfile"
                          disabled={savingId === doc.id}
                          onClick={() => handleAddToFileClick(doc)}
                        >
                          {savingId === doc.id ? "Saving..." : "＋ Add to File"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}