import { useState, useEffect, useCallback } from "react";
import "./ConfirmPortal.css";

// Reuses the same data source as the Delivery Portal — every Check-Done
// document already carries its live deliveryStatus, so we just group
// client-side into three pools instead of hitting three endpoints.
const API_BASE = "http://localhost:8080/api/delivery-portal";
const AUTO_REFRESH = 10000;

const PEOPLE_OPTIONS = ["Shanuka", "Chameera", "Randunu"];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTime(dt) {
  if (!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function statusClass(s) {
  const v = (s || "").toLowerCase();
  if (v.includes("cancel"))   return "cancelled";
  if (v.includes("hold"))     return "onhold";
  if (v.includes("progress")) return "inprogress";
  if (v.includes("complete") || v.includes("done")) return "completed";
  return "pending";
}

// ── Confirm popup (choose who is confirming) ────────────────────────────────

function ConfirmPopup({ title, subtitle, accentClass, onConfirm, onCancel }) {
  const [person, setPerson]     = useState("");
  const [showOther, setShowOther] = useState(false);
  const [otherVal, setOtherVal]   = useState("");

  const finalPerson = showOther ? otherVal.trim() : person;
  const canConfirm  = !!finalPerson;

  return (
    <div className="cp-popup-overlay">
      <div className="cp-popup">
        <div className="cp-popup-head">
          <span>{title}</span>
          <button className="cp-popup-close" onClick={onCancel}>✕</button>
        </div>
        <p className="cp-popup-sub">{subtitle}</p>

        <span className="cp-popup-label">Confirmed By</span>
        <div className="cp-popup-options">
          {PEOPLE_OPTIONS.map(name => (
            <button
              key={name}
              className={`cp-popup-option ${person === name && !showOther ? "selected" : ""}`}
              onClick={() => { setShowOther(false); setPerson(name); }}
            >
              👤 {name}
            </button>
          ))}
          <button
            className={`cp-popup-option ${showOther ? "selected" : ""}`}
            onClick={() => setShowOther(true)}
          >
            ✏️ Other
          </button>
          {showOther && (
            <input
              className="cp-popup-input"
              type="text"
              placeholder="Type name..."
              value={otherVal}
              onChange={e => setOtherVal(e.target.value)}
              autoFocus
            />
          )}
        </div>

        <div className="cp-popup-foot">
          <button className="cp-btn cp-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className={`cp-btn cp-btn-confirm ${accentClass}`}
            disabled={!canConfirm}
            onClick={() => onConfirm(finalPerson)}
          >
            ✔ Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delivered pool table ─────────────────────────────────────────────────────

function DeliveredTable({ docs, onConfirmClick }) {
  if (docs.length === 0) {
    return <div className="cp-empty">No delivered documents right now.</div>;
  }
  return (
    <div className="cp-table-wrap">
      <table className="cp-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Doc No</th>
            <th>Customer</th>
            <th>Delivered By</th>
            <th>Vehicle No</th>
            <th>Delivered At</th>
            <th>Confirm</th>
          </tr>
        </thead>
        <tbody>
          {docs.map(doc => (
            <tr key={doc.id} className="cp-row">
              <td className="cp-td-id">{doc.id}</td>
              <td className="cp-td-docno">{doc.printDocumentNo || `Doc #${doc.id}`}</td>
              <td>{doc.customerName || "—"}</td>
              <td>👤 {doc.deliveredBy || "—"}</td>
              <td>🚐 {doc.deliveryVehicleNo || "—"}</td>
              <td className="cp-td-datetime">{formatDateTime(doc.deliveryEndTime)}</td>
              <td>
                {doc.deliveryConfirmed ? (
                  <span className="cp-badge confirmed">✔ Confirmed</span>
                ) : (
                  <button className="cp-btn-confirm-mini delivered" onClick={() => onConfirmClick(doc)}>
                    Confirm
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Hold pool table (live view only — no confirm needed) ────────────────────

function HoldTable({ docs }) {
  if (docs.length === 0) {
    return <div className="cp-empty">No documents on hold right now.</div>;
  }
  return (
    <div className="cp-table-wrap">
      <table className="cp-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Doc No</th>
            <th>Customer</th>
            <th>Hold Reason</th>
            <th>Held By</th>
            <th>Held At</th>
          </tr>
        </thead>
        <tbody>
          {docs.map(doc => (
            <tr key={doc.id} className="cp-row">
              <td className="cp-td-id">{doc.id}</td>
              <td className="cp-td-docno">{doc.printDocumentNo || `Doc #${doc.id}`}</td>
              <td>{doc.customerName || "—"}</td>
              <td>{doc.deliveryHoldReason || "—"}</td>
              <td>👤 {doc.deliveryHeldBy || "—"}</td>
              <td className="cp-td-datetime">{formatDateTime(doc.deliveryHoldTime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Cancelled pool table ──────────────────────────────────────────────────────

function CancelledTable({ docs, onConfirmClick }) {
  if (docs.length === 0) {
    return <div className="cp-empty">No cancelled documents right now.</div>;
  }
  return (
    <div className="cp-table-wrap">
      <table className="cp-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Doc No</th>
            <th>Customer</th>
            <th>Cancel Reason</th>
            <th>Cancelled By</th>
            <th>Cancelled At</th>
            <th>Confirm</th>
          </tr>
        </thead>
        <tbody>
          {docs.map(doc => (
            <tr key={doc.id} className="cp-row">
              <td className="cp-td-id">{doc.id}</td>
              <td className="cp-td-docno">{doc.printDocumentNo || `Doc #${doc.id}`}</td>
              <td>{doc.customerName || "—"}</td>
              <td>{doc.deliveryCancelReason || "—"}</td>
              <td>👤 {doc.deliveryCancelledBy || "—"}</td>
              <td className="cp-td-datetime">{formatDateTime(doc.deliveryCancelTime)}</td>
              <td>
                {doc.cancelConfirmed ? (
                  <span className="cp-badge cancelled">✔ Confirmed</span>
                ) : (
                  <button className="cp-btn-confirm-mini cancelled" onClick={() => onConfirmClick(doc)}>
                    Confirm
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function ConfirmPortal() {
  const [documents,   setDocuments]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);

  // "delivered" | "cancelled" | null — which confirm popup is open
  const [confirmMode, setConfirmMode] = useState(null);
  const [confirmDoc,  setConfirmDoc]  = useState(null);

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res  = await fetch(API_BASE);
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

  const openConfirm = (doc, mode) => { setConfirmDoc(doc); setConfirmMode(mode); };
  const closeConfirm = () => { setConfirmDoc(null); setConfirmMode(null); };

  const handleConfirm = async (confirmedBy) => {
    const doc  = confirmDoc;
    const mode = confirmMode;
    closeConfirm();
    if (!doc || !mode) return;

    const endpoint = mode === "delivered" ? "confirm-delivery" : "confirm-cancel";
    try {
      await fetch(`${API_BASE}/${doc.id}/${endpoint}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedBy }),
      });
      fetchDocuments(true);
    } catch (err) {
      alert("Confirm failed: " + err.message);
    }
  };

  const deliveredDocs = documents.filter(d => statusClass(d.deliveryStatus) === "completed");
  const onHoldDocs    = documents.filter(d => statusClass(d.deliveryStatus) === "onhold");
  const cancelledDocs = documents.filter(d => statusClass(d.deliveryStatus) === "cancelled");

  return (
    <div className="cp-page">

      {confirmMode === "delivered" && (
        <ConfirmPopup
          title="✅ Confirm Delivery"
          subtitle="Confirm that this document was received / delivered correctly."
          accentClass="delivered"
          onConfirm={handleConfirm}
          onCancel={closeConfirm}
        />
      )}
      {confirmMode === "cancelled" && (
        <ConfirmPopup
          title="✕ Confirm Cancellation"
          subtitle="Confirm that this cancellation has been reviewed."
          accentClass="cancelled"
          onConfirm={handleConfirm}
          onCancel={closeConfirm}
        />
      )}

      {/* ── Header ── */}
      <div className="cp-header">
        <div className="cp-header-left">
          <h1>✔ Confirm Portal</h1>
          <p>
            Review delivered, on-hold and cancelled documents
            {lastUpdated && (
              <span className="cp-updated">
                {refreshing ? "⟳ Refreshing..." : `Updated: ${lastUpdated.toLocaleTimeString()}`}
              </span>
            )}
          </p>
        </div>
        <button className="cp-btn cp-btn-outline" onClick={() => fetchDocuments(false)}>
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="cp-error">
          ⚠ {error} —{" "}
          <button onClick={() => fetchDocuments(false)}>retry</button>
        </div>
      )}

      {/* ── Delivered pool ── */}
      <section className="cp-section">
        <div className="cp-section-head">
          <h2>✅ Delivered <span className="cp-count">{deliveredDocs.length}</span></h2>
        </div>
        {loading ? <div className="cp-empty">Loading...</div> : (
          <DeliveredTable docs={deliveredDocs} onConfirmClick={(doc) => openConfirm(doc, "delivered")} />
        )}
      </section>

      {/* ── Hold pool ── */}
      <section className="cp-section">
        <div className="cp-section-head">
          <h2>⏸ On Hold <span className="cp-count onhold">{onHoldDocs.length}</span></h2>
        </div>
        {loading ? <div className="cp-empty">Loading...</div> : (
          <HoldTable docs={onHoldDocs} />
        )}
      </section>

      {/* ── Cancelled pool ── */}
      <section className="cp-section">
        <div className="cp-section-head">
          <h2>✕ Cancelled <span className="cp-count cancelled">{cancelledDocs.length}</span></h2>
        </div>
        {loading ? <div className="cp-empty">Loading...</div> : (
          <CancelledTable docs={cancelledDocs} onConfirmClick={(doc) => openConfirm(doc, "cancelled")} />
        )}
      </section>
    </div>
  );
}
