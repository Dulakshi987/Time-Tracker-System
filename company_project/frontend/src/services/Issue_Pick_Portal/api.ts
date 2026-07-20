import axios from "axios";

// const API = "http://localhost:8080/api/print-issue";
const API = "https://time-tracker-system-production.up.railway.app/api/print-issue";

/** Start print */
export const startPrint = (data: any) => {
  return axios.post(`${API}/start`, data);
};

/** End print */
export const endPrint = (id: number) => {
  return axios.put(`${API}/end/${id}`);
};

/** Create reservation */
export const reserveIssue = (data: any) => {
  return axios.post(`${API}/reserve`, data);
};

/** Search document by document number */
export const searchDocs = (docNo: string) => {
  return axios.get(`${API}/search`, {
    params: { documentNo: docNo }
  });
};