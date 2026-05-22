import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:8080/api"
});

// SAVE DOCUMENT
export const createDocument = (data) =>
  API.post("/documents", data);

// GET ALL
export const getDocuments = () =>
  API.get("/documents");

// GET BY TYPE
export const getByType = (type) =>
  API.get(`/documents/type/${type}`);