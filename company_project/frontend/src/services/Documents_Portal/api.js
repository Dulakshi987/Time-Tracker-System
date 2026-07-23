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
// NOTE: your DocumentController currently has no PUT /documents/{id}
// endpoint — you'll need to add one, e.g.:
//   @PutMapping("/{id}")
//   public ResponseEntity<?> updateDocument(@PathVariable Long id, @RequestBody Document document) { ... }
export const updateDocument = (id, data) =>
  API.put(`/documents/${id}`, data);

// DELETE DOCUMENT (used by the Delete button in the table)
// NOTE: your DocumentController currently has no DELETE /documents/{id}
// endpoint either — you'll need to add one, e.g.:
//   @DeleteMapping("/{id}")
//   public ResponseEntity<?> deleteDocument(@PathVariable Long id) { ... }
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

// ================= ENTERED BY (Admin → Master Setup → Print / Document Operator) =================
// This is the "Document/Print By" list you described — it matches the
// "Print / Document Operator" section in AdminSetupController:
// @GetMapping("/print-operators") under /api/admin-setup
export const fetchEnteredByUsers = () =>
  API.get("/admin-setup/print-operators");

// ================= ENTERED BY — DIVISION FILTERED (PrintOperator table) =================
// baseURL already ends in /api, so path here must NOT repeat /api.
export const fetchPrintOperatorsByDivision = (divisionNo) =>
  API.get(`/print-operators/by-division/${divisionNo}`);