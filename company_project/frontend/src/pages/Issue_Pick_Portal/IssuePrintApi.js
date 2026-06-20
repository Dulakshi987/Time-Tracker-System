import axios from "axios";

const API = "http://localhost:8080/api/pick-issue";

export const startPrint = (data: any) =>
  axios.post(`${API}/start`, data);

export const endPrint = (id: number) =>
  axios.put(`${API}/end/${id}`);

export const reserveIssue = (data: any) =>
  axios.post(`${API}/reserve`, data);

export const searchDocs = (docNo: string) =>
  axios.get(`${API}/search`, {
    params: { documentNo: docNo }
  });