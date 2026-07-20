import axios from "axios";

const API = "http://localhost:8080/api/pick-issue";

export const startPrint = (data) =>
  axios.post(`${API}/start`, data);

export const endPrint = (id) =>
  axios.put(`${API}/end/${id}`);

export const reserveIssue = (data) =>
  axios.post(`${API}/reserve`, data);

export const searchDocs = (docNo) =>
  axios.get(`${API}/search`, {
    params: { documentNo: docNo }
  });