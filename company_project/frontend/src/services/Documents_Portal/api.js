import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:8080/api"
});

export const getDocuments = () => API.get("/documents");
export const getByType = (type) => API.get(`/documents/type/${type}`);
export const createDocument = (data) => API.post("/documents", data);