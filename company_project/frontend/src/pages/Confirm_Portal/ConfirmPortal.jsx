import { useState, useEffect, useCallback, useMemo } from "react";
import "./ConfirmPortal.css";

const DELIVERY_API = "http://localhost:8080/api/delivery-portal";
const CONFIRM_API = "http://localhost:8080/api/issue-confirm";
// Same source Master Setup → "Document File No" panel writes to.
const SETUP_API = "http://localhost:8080/api/admin-setup";
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

// Once a document has a fileNumber, its badge/status is shown as "Filed"
// regardless of the underlying delivered/hold/cancelled status.
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
  if (sc === "onhold") {
    return { dateTime: doc.deliveryHoldTime, by: doc.deliveryHeldBy, reason: doc.deliveryHoldReason };
  }
  if (sc === "cancelled") {
    return { dateTime: doc.deliveryCancelTime, by: doc.deliveryCancelledBy, reason: doc.deliveryCancelReason };
  }
  return { dateTime: null, by: null, reason: null };
}

// ── Active file number (set by admin in Master Setup → Document File No) ──
// Fetches the single record marked "active" — the Master Setup panel
// guarantees only one is ever active at a time.
async function fetchActiveFileNumber() {
  const res = await fetch(`${SETUP_API}/file-numbers`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const list = await res.json();
  const active = list.find(f => f.active === true || f.active === "true");
  return active ? active.fileNo : null;
}

// ── Add to File popup ───────────────────────────────────────────────────────
// File number is no longer typed by hand — it's pulled straight from the
// active record admin set up in Master Setup, so this portal and the admin
// panel always agree on which file number is currently in use.

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

// ── View Drawer helpers (same pattern as Delivery Portal) ─────────────────

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

// ── Side Drawer: full document trail (mirrors Delivery Portal's ViewDrawer,
// plus a File Details section at the end for this portal) ─────────────────

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

          {/* Request info */}
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

          {/* Print trail */}
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

          {/* Picking trail */}
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

          {/* Check trail (incl. picking error) */}
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

          {/* Delivery trail */}
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

          {/* Hold info */}
          {(statusClass(doc.deliveryStatus) === "onhold" || doc.deliveryHoldReason) && (
            <Section icon="⏸" title="Delivery Hold" accent="hold">
              <DetailRow label="Hold Reason" value={doc.deliveryHoldReason} />
              <DetailRow label="Held By" value={doc.deliveryHeldBy} />
              <DetailRow label="Held At" value={formatDateTime(doc.deliveryHoldTime)} />
              <DetailRow label="Resume Time" value={formatDateTime(doc.deliveryResumeTime)} />
            </Section>
          )}

          {/* Cancel info */}
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

          {/* File info — specific to Confirm Portal */}
          <Section icon="📁" title="File Details" accent="file">
            <DetailRow label="Req ID" value={doc.reqId || reqId} />
            <DetailRow label="File Number" value={doc.fileNumber ? `📁 ${doc.fileNumber}` : "Not yet added to file"} />
          </Section>

        </div>

        <div className="icf-popup-foot">
          <button className="icf-btn icf-btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function IssueConfirm() {
  const [documents,   setDocuments]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [filterStatus, setFilterStatus] = useState("ALL"); // ALL | completed | onhold | cancelled
  const [savingId,    setSavingId]    = useState(null);
  const [viewDoc,     setViewDoc]     = useState(null);

  // Add-to-File popup state — file number now comes from Master Setup, not
  // typed in by hand, so we track the doc being filed plus the fetched
  // active file number / loading / error state for that fetch.
  const [fileDoc,       setFileDoc]       = useState(null);
  const [activeFileNo,  setActiveFileNo]  = useState(null);
  const [loadingFileNo, setLoadingFileNo] = useState(false);
  const [fileNoError,   setFileNoError]   = useState(null);

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

  // Only the 3 finalised pools belong on this portal
  const relevant = documents.filter(d => ["completed", "onhold", "cancelled"].includes(statusClass(d.deliveryStatus)));

  const visible = filterStatus === "ALL"
    ? relevant
    : relevant.filter(d => statusClass(d.deliveryStatus) === filterStatus);

  const counts = {
    completed: relevant.filter(d => statusClass(d.deliveryStatus) === "completed").length,
    onhold:    relevant.filter(d => statusClass(d.deliveryStatus) === "onhold").length,
    cancelled: relevant.filter(d => statusClass(d.deliveryStatus) === "cancelled").length,
  };

  // keep the view drawer's data in sync after a refresh
  useEffect(() => {
    if (!viewDoc) return;
    const fresh = documents.find(d => d.id === viewDoc.id);
    if (fresh) setViewDoc(fresh);
  }, [documents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening "Add to File" now pulls the active file number set by admin in
  // Master Setup → Document File No, instead of showing a blank text box.
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

      {/* Header */}
       <div className="ip-header">
        <div className="ip-header-left">
          <h1>LOGITRACK-WAREHOUSE TIME EFFICENCY TRACKER SYSTEM</h1>
          <h1>  Issue Confirm Portal</h1>
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

      {/* Toolbar — the 3-way status filter */}
      <div className="icf-toolbar">
        <select
          className="icf-filter-select"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="ALL">All Status</option>
          <option value="completed">Delivered</option>
          <option value="onhold">Hold</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <div className="icf-stats">
          <div className="icf-stat-chip completed">Delivered <strong>{counts.completed}</strong></div>
          <div className="icf-stat-chip onhold">Hold <strong>{counts.onhold}</strong></div>
          <div className="icf-stat-chip cancelled">Cancelled <strong>{counts.cancelled}</strong></div>
        </div>
      </div>

      {error && (
        <div className="icf-error">
          ⚠ {error} — <button onClick={() => fetchDocuments(false)}>retry</button>
        </div>
      )}

      {/* Unified table */}
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
              <th>Hold By / Reason</th>
              <th>Date / Time</th>
              <th>Job Type</th>
              <th>View</th>
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

                return (
                  <tr key={doc.id} className="icf-row">
                    <td><span className={`icf-badge ${ds.cls}`}>{ds.label}</span></td>
                    <td className="icf-td-reqid">{doc.reqId || reqIdMap[doc.id] || "—"}</td>
                    <td className="icf-td-docno">{doc.printDocumentNo || `Doc #${doc.id}`}</td>
                    <td>{doc.requestedBy || "—"}</td>
                    <td>🚐 {doc.deliveryVehicleNo || "—"}</td>
                    <td>{sc === "completed" ? `👤 ${info.by || "—"}` : "—"}</td>
                    <td>{sc === "cancelled" ? `👤 ${info.by || "—"}` : "—"}</td>
                    <td>
                      {sc === "onhold"
                        ? <>👤 {info.by || "—"}<br /><span className="icf-reason">{info.reason || "—"}</span></>
                        : "—"}
                    </td>
                    <td className="icf-td-datetime">{formatDateTime(info.dateTime)}</td>
                    <td>{doc.jobType || "—"}</td>
                    <td>
                      <button className="icf-btn-view" onClick={() => setViewDoc(doc)}>👁 View</button>
                    </td>
                    <td>
                      {doc.fileNumber ? (
                        <span className="icf-filenum">📁 {doc.fileNumber}</span>
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
