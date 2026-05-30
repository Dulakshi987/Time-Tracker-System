import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:8080/api"
});

export const getDocuments = () => API.get("/documents");
export const getByType = (type) => API.get(`/documents/type/${type}`);
export const createDocument = (data) => API.post("/documents", data);

// ✅ ADD THIS (DATE RANGE FILTER)
export const getByDateRange = (fromDate, toDate, type) =>
  API.get("/documents", {
    params: {
      fromDate,
      toDate,
      type
    }
  });

  const loadDocuments = async () => {

  const res = await axios.get(
    "http://localhost:8080/api/documents",
    {
      params: {
        fromDate: chartFilter.fromDate || null,
        toDate: chartFilter.toDate || null,
        type: selectedType
      }
    }
  );

  setDocuments(res.data);
};