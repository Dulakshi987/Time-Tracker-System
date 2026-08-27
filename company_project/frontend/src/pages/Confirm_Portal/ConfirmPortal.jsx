import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "./ConfirmPortal.css";
import { formatSriLankaTime } from "../../utils/dateUtils";
import {
  getCurrentUser, canAccessRoute, canUseButton, logoutUser,
  hasAllDivisionAccess, getUserDivisions,
} from "../../config/permissions";
// ⚠️ Adjust the path above ("../../config/permissions") to match where
//    permissions.js actually sits relative to this file.

// const CONFIRM_API = "http://localhost:8080/api/issue-confirm";
// const SETUP_API = "http://localhost:8080/api/admin-setup";

const CONFIRM_API = "https://time-tracker-system-production.up.railway.app/api/issue-confirm";
const SETUP_API = "https://time-tracker-system-production.up.railway.app/api/admin-setup";

// ── Data-usage settings ─────────────────────────────────────────────────
// NOTE ON RAILWAY / DATA USAGE:
// This page used to pull EVERY delivered/cancelled document on every load
// (fetch(DELIVERY_API) → the full document list), then filter/search/
// paginate all of it in the browser, with no pagination at all — the
// whole table rendered every matching row at once. On mobile data that's
// expensive, and it's what was driving Railway's egress usage up.
//
// Fixed here the same way as the Delivery Portal:
//  - No background polling (nothing loops).
//  - The table now calls a paginated backend endpoint (/paged) that does
//    all searching/filtering/sorting server-side and only ever sends back
//    one page of rows (see PAGE_SIZE_OPTIONS below) plus small stat
//    totals — never the full document list.
//  - Search is debounced so typing doesn't fire a request per keystroke.
//  - Req ID numbering is computed server-side (date-grouped, stable
//    across pages) instead of being recomputed client-side from whatever
//    partial list happened to be loaded.
//  - The Division filter is filled from Master Setup (/divisions) instead
//    of being derived from a full document list.
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 450;

// ── Date filter options — Today (Sri Lanka time, default) / All / Custom
// range. Same pattern as Print Portal / Pick Portal / Check Portal /
// Delivery Portal.
const DATE_FILTER_OPTIONS = [
  { value: "TODAY", label: "Today" },
  { value: "ALL", label: "All" },
  { value: "CUSTOM", label: "Custom" },
];

// ── Status filter options — clickable pill buttons. "filed" matches any
// document that has a File Number attached, regardless of whether it was
// Delivered or Cancelled underneath.
const STATUS_FILTER_OPTIONS = [
  { value: "ALL", label: "All Status" },
  { value: "completed", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "filed", label: "Filed" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d) { return d || "—"; }
function formatTime(t) { return t ? String(t).substring(0, 5) : "—"; }

function formatDateTime(dt) {
  if (!dt) return "—";
  return formatSriLankaTime(dt);
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

function buildQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, v);
  });
  return qs.toString();
}

// ── Active file numbers ───────────────────────────────────────────────────
// Multiple File Numbers can be marked ACTIVE at once in Master Setup now
// (see AdminSetupService / AdminSetupController), so this returns the
// FULL list of currently-active rows instead of picking just one. Falls
// back to filtering `/file-numbers` client-side if the dedicated
// `/file-numbers/active` endpoint isn't available for some reason.
async function fetchActiveFileNumbers() {
  try {
    const res = await fetch(`${SETUP_API}/file-numbers/active`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
      // Older backend still returning a single object/null — normalize.
      return data ? [data] : [];
    }
  } catch (e) {
    // fall through to the manual filter below
  }

  const res = await fetch(`${SETUP_API}/file-numbers`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const list = await res.json();
  return (Array.isArray(list) ? list : []).filter(
    f => f.active === true || f.active === "true"
  );
}

// ── Add to File popup ───────────────────────────────────────────────────────

function AddFilePopup({
  doc, activeFileNumbers, selectedFileNo, onSelectFileNo,
  loadingFileNo, fileNoError, onConfirm, onCancel,
}) {
  const canConfirm = !!selectedFileNo && !loadingFileNo;

  return (
    <div className="icf-popup-overlay">
      <div className="icf-popup" style={{ color: "#1a1a1a" }}>
        <div className="icf-popup-head" style={{ color: "#111" }}>
          <span style={{ color: "#111", fontWeight: 700 }}>📁 Add to File</span>
          <button className="icf-popup-close" onClick={onCancel} style={{ color: "#333" }}>✕</button>
        </div>
        <p className="icf-popup-sub" style={{ color: "#333" }}>
          {doc.printDocumentNo || `Doc #${doc.id}`} (Req ID: {doc.reqId || "—"}) සඳහා
          admin විසින් Active කළ file number එකක් තෝරන්න
        </p>

        <div className="icf-popup-field">
          <span className="icf-popup-label" style={{ color: "#222", fontWeight: 600 }}>
            Active File Numbers{activeFileNumbers.length > 0 ? ` (${activeFileNumbers.length})` : ""}
          </span>

          {loadingFileNo ? (
            <div style={{ color: "#555", padding: "10px 0" }}>Loading...</div>
          ) : activeFileNumbers.length > 0 ? (
            <div
              style={{
                display: "flex", flexDirection: "column", gap: 8,
                maxHeight: 240, overflowY: "auto", marginTop: 8,
              }}
            >
              {activeFileNumbers.map(f => {
                const isSelected = selectedFileNo === f.fileNo;
                return (
                  <label
                    key={f.id ?? f.fileNo}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                      border: isSelected ? "2px solid #7c3aed" : "1.5px solid #d8dee8",
                      background: isSelected ? "#f5f0ff" : "#fff",
                    }}
                  >
                    <input
                      type="radio"
                      name="active-file-no"
                      checked={isSelected}
                      onChange={() => onSelectFileNo(f.fileNo)}
                    />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 700, color: "#111" }}>📁 {f.fileNo}</span>
                      {(f.fromDate || f.toDate) && (
                        <span style={{ fontSize: "0.78rem", color: "#555" }}>
                          {f.fromDate || "—"} → {f.toDate || "—"}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>

        {!loadingFileNo && fileNoError && (
          <div className="icf-error" style={{ marginTop: 8 }}>
            ⚠ Could not load active file numbers: {fileNoError}
          </div>
        )}
        {!loadingFileNo && !fileNoError && activeFileNumbers.length === 0 && (
          <div className="icf-error" style={{ marginTop: 8 }}>
            ⚠ Admin has not marked any file number as Active yet in Master Setup → Document File No.
          </div>
        )}

        <div className="icf-popup-foot" style={{ justifyContent: "flex-end", gap: 12 }}>
          <button
            className="icf-btn icf-btn-outline"
            onClick={onCancel}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              border: "1.5px solid #94a3b8", background: "#fff",
              color: "#334155", fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            className="icf-btn-done"
            disabled={!canConfirm}
            onClick={() => onConfirm(selectedFileNo)}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              background: "#7c3aed", color: "#fff", fontWeight: 600,
              border: "none", cursor: canConfirm ? "pointer" : "not-allowed",
              opacity: canConfirm ? 1 : 0.6,
            }}
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
      <div className="icf-popup" style={{ color: "#1a1a1a" }}>
        <div className="icf-popup-head" style={{ color: "#111" }}>
          <span style={{ color: "#111", fontWeight: 700 }}>📁 Edit File Number</span>
          <button className="icf-popup-close" onClick={onCancel} style={{ color: "#333" }}>✕</button>
        </div>
        <p className="icf-popup-sub" style={{ color: "#333" }}>
          {doc.printDocumentNo || `Doc #${doc.id}`} — currently filed as{" "}
          <strong>{doc.fileNumber}</strong>
        </p>

        <div className="icf-popup-field">
          <span className="icf-popup-label" style={{ color: "#222", fontWeight: 600 }}>File Number</span>
          <input
            className="icf-popup-text-input"
            type="text"
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            placeholder="Enter file number"
            disabled={saving}
            style={{ color: "#111" }}
          />
        </div>

        <div className="icf-popup-foot" style={{ gap: 12 }}>
          <button
            className="icf-btn-danger"
            disabled={saving}
            onClick={onDelete}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              background: "#fee2e2", color: "#b91c1c", border: "1.5px solid #f87171",
              fontWeight: 600, cursor: "pointer",
            }}
          >
            🗑 Delete
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="icf-btn icf-btn-outline"
            disabled={saving}
            onClick={onCancel}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              border: "1.5px solid #94a3b8", background: "#fff",
              color: "#334155", fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            className="icf-btn-done"
            disabled={saving || !editValue.trim()}
            onClick={onSave}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              background: "#7c3aed", color: "#fff", fontWeight: 600,
              border: "none", cursor: "pointer",
            }}
          >
            {saving ? "Saving..." : "✓ Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Status popup (NO Delete button) ────────────────────────────────────

function StatusEditPopup({ doc, fields, onFieldChange, saving, onSave, onCancel }) {
  const sc = statusClass(doc.deliveryStatus);
  const isDelivered = sc === "completed";

  return (
    <div className="icf-popup-overlay">
      <div className="icf-popup" style={{ color: "#1a1a1a" }}>
        <div className="icf-popup-head" style={{ color: "#111" }}>
          <span style={{ color: "#111", fontWeight: 700 }}>
            {isDelivered ? "🚚 Edit Delivered Details" : "✕ Edit Cancelled Details"}
          </span>
          <button className="icf-popup-close" onClick={onCancel} style={{ color: "#333" }}>✕</button>
        </div>

        <p className="icf-popup-sub" style={{ color: "#333", marginBottom: 16 }}>
          {doc.printDocumentNo || `Doc #${doc.id}`}
        </p>

        {isDelivered ? (
          <div className="icf-popup-field">
            <span className="icf-popup-label" style={{ color: "#222", fontWeight: 600 }}>Delivered By</span>
            <input
              className="icf-popup-text-input"
              type="text"
              value={fields.deliveredBy}
              onChange={e => onFieldChange("deliveredBy", e.target.value)}
              placeholder="Enter name"
              disabled={saving}
              style={{ color: "#111" }}
            />
          </div>
        ) : (
          <>
            <div className="icf-popup-field">
              <span className="icf-popup-label" style={{ color: "#222", fontWeight: 600 }}>Cancelled By</span>
              <input
                className="icf-popup-text-input"
                type="text"
                value={fields.deliveryCancelledBy}
                onChange={e => onFieldChange("deliveryCancelledBy", e.target.value)}
                placeholder="Enter name"
                disabled={saving}
                style={{ color: "#111" }}
              />
            </div>
            <div className="icf-popup-field">
              <span className="icf-popup-label" style={{ color: "#222", fontWeight: 600 }}>Cancel Reason</span>
              <input
                className="icf-popup-text-input"
                type="text"
                value={fields.deliveryCancelReason}
                onChange={e => onFieldChange("deliveryCancelReason", e.target.value)}
                placeholder="Enter reason"
                disabled={saving}
                style={{ color: "#111" }}
              />
            </div>
          </>
        )}

        <div className="icf-popup-foot" style={{ justifyContent: "flex-end", gap: 12, marginTop: 20 }}>
          <button
            className="icf-btn icf-btn-outline"
            disabled={saving}
            onClick={onCancel}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              border: "1.5px solid #94a3b8", background: "#fff",
              color: "#334155", fontWeight: 600, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            className="icf-btn-done"
            disabled={saving}
            onClick={onSave}
            style={{
              minWidth: 90, padding: "8px 18px", borderRadius: 8,
              background: "#7c3aed", color: "#fff", fontWeight: 600,
              border: "none", cursor: "pointer",
            }}
          >
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

function ViewDrawer({ doc, onClose }) {
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
            <DetailRow label="Req ID" value={doc.reqId} />
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
            <DetailRow label="Req ID" value={doc.reqId} />
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

// ── Pagination bar ──────────────────────────────────────────────────────────

function PaginationBar({ page, totalPages, totalElements, pageSize, onPageChange, onPageSizeChange }) {
  const safeTotalPages = Math.max(totalPages, 1);
  const from = totalElements === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalElements);

  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 10, padding: "12px 4px", color: "#6c8bb3", fontSize: "0.85rem",
      }}
    >
      <span>{totalElements === 0 ? "No rows" : `Showing ${from}–${to} of ${totalElements}`}</span>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <select
          className="icf-filter-select"
          value={pageSize}
          onChange={e => onPageSizeChange(Number(e.target.value))}
          style={{ padding: "6px 10px" }}
        >
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>

        <button
          type="button"
          className="icf-btn icf-btn-outline"
          style={{ flex: "unset", padding: "6px 14px" }}
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          ‹ Prev
        </button>
        <span>Page {page + 1} of {safeTotalPages}</span>
        <button
          type="button"
          className="icf-btn icf-btn-outline"
          style={{ flex: "unset", padding: "6px 14px" }}
          disabled={page + 1 >= safeTotalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function IssueConfirm() {
  const navigate = useNavigate();

  // ── Auth / role guard ──
  const currentUser = getCurrentUser();

  useEffect(() => {
    if (!currentUser || !canAccessRoute(currentUser, "/confirm")) {
      navigate("/login", { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isAdminRole =
    currentUser?.staffName === "Admin" ||
    currentUser?.staffName === "System Administrator";

  const handleLogout = () => {
    logoutUser();
    navigate("/login", { replace: true });
  };

  const canManageDocs = canUseButton(currentUser, "edit") || canUseButton(currentUser, "delete");
  const visibleColumnCount = canManageDocs ? 12 : 11;

  // ── Division access ──
  const hasAllDiv = hasAllDivisionAccess(currentUser);
  const userDivisions = useMemo(() => getUserDivisions(currentUser), [currentUser]);
  const allowedDivisionsCsv = hasAllDiv ? "" : userDivisions.join(",");

  // ── Table data (current page only) ──
  const [documents,   setDocuments]   = useState([]);
  const [stats,       setStats]       = useState(null); // { total, completed, cancelled, filed }
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);

  // ── Pagination ──
  const [page,     setPage]     = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalPages,    setTotalPages]    = useState(0);
  const [totalElements, setTotalElements] = useState(0);

  // ── Filters ──
  const [search,        setSearch]        = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterStatus,  setFilterStatus]  = useState("ALL"); // ALL | completed | cancelled | filed
  const [filterDivision, setFilterDivision] = useState("ALL");
  const [dateFilterMode, setDateFilterMode] = useState("TODAY"); // TODAY | ALL | CUSTOM
  const [fromDate,      setFromDate]      = useState("");
  const [toDate,        setToDate]        = useState("");

  // Debounce search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // Divisions (Admin Master Data) — used to populate the Division filter
  // dropdown. Loaded once, NOT derived from the (now partial) document list.
  const [divisions, setDivisions] = useState([]);

  const [savingId, setSavingId] = useState(null);
  const [viewDoc,  setViewDoc]  = useState(null);

  // Add-to-File popup — now holds the FULL list of active file numbers,
  // plus which one the user has picked (radio selection in the popup).
  const [fileDoc,            setFileDoc]            = useState(null);
  const [activeFileNumbers,  setActiveFileNumbers]  = useState([]);
  const [selectedFileNo,     setSelectedFileNo]     = useState(null);
  const [loadingFileNo,      setLoadingFileNo]      = useState(false);
  const [fileNoError,        setFileNoError]        = useState(null);

  // Edit/Delete FILE popup
  const [editFileDoc,      setEditFileDoc]      = useState(null);
  const [editFileValue,    setEditFileValue]    = useState("");
  const [fileActionSaving, setFileActionSaving] = useState(false);

  // Edit STATUS popup
  const [editStatusDoc,      setEditStatusDoc]      = useState(null);
  const [statusFields,       setStatusFields]       = useState({ deliveredBy: "", deliveryCancelledBy: "", deliveryCancelReason: "" });
  const [statusActionSaving, setStatusActionSaving] = useState(false);

  // ── Fetch current page from the server (search/filters/pagination all
  // applied server-side — no full-list download). ──
  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const query = buildQuery({
        page, size: pageSize,
        search: debouncedSearch,
        status: filterStatus,
        divisionNo: filterDivision === "ALL" && !hasAllDiv ? "" : filterDivision,
        dateMode: dateFilterMode,
        fromDate: dateFilterMode === "CUSTOM" ? fromDate : "",
        toDate: dateFilterMode === "CUSTOM" ? toDate : "",
      });
      const res = await fetch(`${CONFIRM_API}/paged?${query}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setDocuments(Array.isArray(data.content) ? data.content : []);
      setTotalElements(data.totalElements || 0);
      setTotalPages(data.totalPages || 0);
      setStats(data.stats || null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, pageSize, debouncedSearch, filterStatus, filterDivision, hasAllDiv, dateFilterMode, fromDate, toDate]);

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

  useEffect(() => {
    fetchDivisions();
  }, [fetchDivisions]);

  // Reset to page 1 whenever a filter (other than page/pageSize itself)
  // changes, so you don't end up stuck on an out-of-range page.
  const filterKey = useMemo(() => JSON.stringify({
    debouncedSearch, filterStatus, filterDivision, dateFilterMode, fromDate, toDate,
  }), [debouncedSearch, filterStatus, filterDivision, dateFilterMode, fromDate, toDate]);

  const isFirstFilterRun = useRef(true);
  useEffect(() => {
    if (isFirstFilterRun.current) { isFirstFilterRun.current = false; return; }
    setPage(0);
  }, [filterKey]);

  // Single source of truth: fetch whenever page or any filter changes.
  useEffect(() => {
    fetchDocuments(false);
  }, [fetchDocuments]);

  // Division dropdown — Admin/System Admin get every division from Master
  // Setup; every other login only ever gets their own assigned division(s).
  const divisionOptions = useMemo(() => {
    const list = hasAllDiv
      ? divisions.map(d => d.divisionNo).filter(Boolean)
      : userDivisions;
    return ["ALL", ...list];
  }, [hasAllDiv, userDivisions, divisions]);

  const hasActiveToolbarFilters =
    search.trim() !== "" || filterStatus !== "ALL" || filterDivision !== "ALL";

  // keep the view drawer's data in sync after a refresh of the current page
  useEffect(() => {
    if (!viewDoc) return;
    const fresh = documents.find(d => d.id === viewDoc.id);
    if (fresh) setViewDoc(fresh);
  }, [documents]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add to File ──
  const handleAddToFileClick = async (doc) => {
    setFileDoc(doc);
    setActiveFileNumbers([]);
    setSelectedFileNo(null);
    setFileNoError(null);
    setLoadingFileNo(true);
    try {
      const list = await fetchActiveFileNumbers();
      setActiveFileNumbers(list);
      // If there's only one active file number, pre-select it so the
      // common case (one active file) still needs just one click.
      if (list.length === 1) setSelectedFileNo(list[0].fileNo);
    } catch (err) {
      setFileNoError(err.message);
    } finally {
      setLoadingFileNo(false);
    }
  };

  const closeFilePopup = () => {
    setFileDoc(null);
    setActiveFileNumbers([]);
    setSelectedFileNo(null);
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
        body: JSON.stringify({ reqId: doc.reqId, fileNumber }),
      });
      if (res.status === 409) {
        await fetchDocuments(true);
        return;
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      await fetchDocuments(true);
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
      closeFileEdit();
      fetchDocuments(true);
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
      closeFileEdit();
      fetchDocuments(true);
    } catch (err) {
      alert("Delete failed: " + err.message);
    } finally {
      setFileActionSaving(false);
    }
  };

  // ── Status Edit ──
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
      closeStatusEdit();
      fetchDocuments(true);
    } catch (err) {
      alert("Edit failed: " + err.message);
    } finally {
      setStatusActionSaving(false);
    }
  };

  // Delete document (from Manage column)
  const handleDeleteDocument = async (doc) => {
    if (!doc) return;
    if (!window.confirm(`Permanently delete ${doc.printDocumentNo || `Doc #${doc.id}`}? This cannot be undone.`)) return;

    try {
      const res = await fetch(`${CONFIRM_API}/${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      fetchDocuments(true);
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  // Manage → Edit
  const handleManageEdit = (doc) => {
    if (doc.fileNumber) {
      openFileEdit(doc);
    } else {
      openStatusEdit(doc);
    }
  };

  if (!currentUser || !canAccessRoute(currentUser, "/confirm")) {
    return null;
  }

  const total     = stats?.total ?? 0;
  const completed = stats?.completed ?? 0;
  const cancelled = stats?.cancelled ?? 0;
  const filed     = stats?.filed ?? 0;

  return (
    <div className="icf-page">

      {viewDoc && (
        <ViewDrawer doc={viewDoc} onClose={() => setViewDoc(null)} />
      )}

      {fileDoc && (
        <AddFilePopup
          doc={fileDoc}
          activeFileNumbers={activeFileNumbers}
          selectedFileNo={selectedFileNo}
          onSelectFileNo={setSelectedFileNo}
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
        <div style={{ display: "flex", gap: 10 }}>
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

      {/* Toolbar — Search + clickable Status filter (Delivered / Cancelled /
          Filed) + Division No filter */}
      <div className="icf-date-toolbar">
        <div className="icf-search-wrap">
          <span className="icf-search-icon">🔍</span>
          <input
            className="icf-search"
            type="text"
            placeholder="Search by Req ID, Doc No, Reservation, Customer, Vehicle No..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {STATUS_FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={`icf-filter-select icf-stat-chip-clickable ${filterStatus === opt.value ? "active" : ""}`}
            style={{ cursor: "pointer", fontWeight: filterStatus === opt.value ? 700 : 500 }}
            onClick={() => setFilterStatus(opt.value)}
          >
            {opt.label}
          </button>
        ))}

        <select
          className="icf-filter-select"
          value={filterDivision}
          onChange={e => setFilterDivision(e.target.value)}
          title="Filter by Division No"
        >
          {divisionOptions.map(dv => (
            <option key={dv} value={dv}>{dv === "ALL" ? "All Divisions" : dv}</option>
          ))}
        </select>

        {hasActiveToolbarFilters && (
          <button
            type="button"
            className="icf-btn icf-btn-outline"
            style={{ flex: "unset", padding: "8px 18px" }}
            onClick={() => { setSearch(""); setFilterStatus("ALL"); setFilterDivision("ALL"); }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* ── Date filter — Today (Sri Lanka time, default) / All / Custom
          range. Same toolbar pattern as Print Portal / Pick Portal / Check
          Portal / Delivery Portal. ── */}
      <div className="icf-date-toolbar" style={{ marginTop: -6 }}>
        {DATE_FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={`icf-filter-select icf-stat-chip-clickable ${dateFilterMode === opt.value ? "active" : ""}`}
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
              className="icf-filter-select"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
            />
            <span style={{ color: "#6c8bb3" }}>—</span>
            <input
              type="date"
              className="icf-filter-select"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
            />
            {(fromDate || toDate) && (
              <button
                type="button"
                className="icf-btn icf-btn-outline"
                style={{ flex: "unset", padding: "6px 14px" }}
                onClick={() => { setFromDate(""); setToDate(""); }}
              >
                ✕ Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="icf-date-toolbar" style={{ marginTop: -6, gap: 10 }}>
        <div className="icf-filter-select">Total <strong>{total}</strong></div>
        <div className="icf-filter-select">Delivered <strong style={{ color: "#22c55e" }}>{completed}</strong></div>
        <div className="icf-filter-select">Cancelled <strong style={{ color: "#ef4444" }}>{cancelled}</strong></div>
        <div className="icf-filter-select">Filed <strong style={{ color: "#a78bfa" }}>{filed}</strong></div>
        <div className="icf-filter-select">Showing <strong style={{ color: "#a78bfa" }}>{documents.length}</strong> of {totalElements}</div>
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
              {canManageDocs && <th>Manage</th>}
              <th>File No.</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={visibleColumnCount} className="icf-empty-cell">Loading...</td></tr>
            ) : documents.length === 0 ? (
              <tr><td colSpan={visibleColumnCount} className="icf-empty-cell">No documents found.</td></tr>
            ) : (
              documents.map(doc => {
                const sc = statusClass(doc.deliveryStatus);
                const info = eventInfo(doc);
                const ds = displayStatus(doc);
                const isFiled = !!doc.fileNumber;

                return (
                  <tr key={doc.id} className="icf-row">
                    <td>
                      <span
                        className={`icf-badge ${ds.cls}`}
                        style={{ cursor: "pointer" }}
                        title="Click to edit"
                        onClick={() => (isFiled ? openFileEdit(doc) : openStatusEdit(doc))}
                      >
                        {ds.label}
                      </span>
                    </td>

                    <td className="icf-td-reqid">{doc.reqId || "—"}</td>

                    <td className="icf-td-docno">{doc.printDocumentNo || `Doc #${doc.id}`}</td>

                    <td>{doc.requestedBy || "—"}</td>

                    <td>🚐 {doc.deliveryVehicleNo || "—"}</td>

                    <td>{sc === "completed" ? `👤 ${info.by || "—"}` : "—"}</td>

                    <td>{sc === "cancelled" ? `👤 ${info.by || "—"}` : "—"}</td>

                    <td className="icf-td-datetime">{formatDateTime(info.dateTime)}</td>

                    <td>
                      <span style={{ color: jobTypeColor(doc.jobType), fontWeight: 600 }}>
                        {doc.jobType || "—"}
                      </span>
                    </td>

                    <td>
                      <button className="icf-btn-view" onClick={() => setViewDoc(doc)}>
                        👁 View
                      </button>
                    </td>

                    {canManageDocs && (
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
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
                    )}

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

      {/* ── Pagination ── */}
      <PaginationBar
        page={page}
        totalPages={totalPages}
        totalElements={totalElements}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
      />
    </div>
  );
}
