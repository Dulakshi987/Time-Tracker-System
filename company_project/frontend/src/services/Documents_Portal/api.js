import axios from "axios";

// const API = axios.create({
//   baseURL: "http://localhost:8080/api"
// });

const API = axios.create({
  baseURL: "https://time-tracker-system-production.up.railway.app/api"
});

// ================= DOCUMENTS =================

// SAVE DOCUMENT
export const createDocument = (data) =>
  API.post("/documents", data);

// UPDATE DOCUMENT (used when editing a row in the table)
export const updateDocument = (id, data) =>
  API.put(`/documents/${id}`, data);

// DELETE DOCUMENT (used by the Delete button in the table)
export const deleteDocument = (id) =>
  API.delete(`/documents/${id}`);

// GET ALL (kept for anything still using the old name)
export const getDocuments = () =>
  API.get("/documents");

// Alias used by DocumentForm.jsx — same endpoint as getDocuments
export const fetchAllDocuments = () =>
  API.get("/documents");

// GET BY TYPE (kept for anything still using the old name)
export const getByType = (type) =>
  API.get(`/documents/type/${type}`);

// Alias used by DocumentForm.jsx — same endpoint as getByType
export const fetchDocumentsByType = (type) =>
  API.get(`/documents/type/${type}`);

// ================= JOB CATEGORIES (Admin → Master Setup → Job Category) =================
// Matches AdminSetupController: @GetMapping("/job-categories") under /api/admin-setup
export const fetchJobCategories = () =>
  API.get("/admin-setup/job-categories");

// ================= DIVISIONS (Admin → Master Setup → Division) =================
// Matches AdminSetupController: @GetMapping("/divisions") under /api/admin-setup
// This is what drives DocumentForm.jsx's Division dropdown (divisionNo/divisionName).
export const fetchDivisions = () =>
  API.get("/admin-setup/divisions");

// ================= ENTERED BY — old, ungrouped list (kept in case anything else still calls it) =================
export const fetchEnteredByUsers = () =>
  API.get("/admin-setup/print-operators");

// ================= ENTERED BY — DIVISION FILTERED (PrintOperator table, NIC names) =================
// Matches PrintOperatorController: @GetMapping("/by-division/{divisionNo}")
// under @RequestMapping("/api/print-operators").
// baseURL already ends in /api — do NOT repeat /api here, and use API not api.
export const fetchPrintOperatorsByDivision = (divisionNo) =>
  API.get(`/print-operators/by-division/${divisionNo}`);