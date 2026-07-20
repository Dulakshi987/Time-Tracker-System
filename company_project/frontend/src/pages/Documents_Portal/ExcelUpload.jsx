import axios from "axios";

// Reusable Excel template/upload block. Pass `onUploaded` so the parent
// (e.g. DocumentForm) can refresh its table right after a successful
// upload — same pattern as loadRows() in DocumentForm.jsx.
const ExcelUpload = ({ onUploaded }) => {

  // const downloadTemplate = () => {
  //   window.open("http://localhost:8080/api/excel/download-template");
  // };

  const downloadTemplate = () => {
  window.open(
    `${import.meta.env.VITE_API_URL}/api/excel/download-template`
  );
};

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      // const res = await axios.post(
      //   "http://localhost:8080/api/excel/upload",
      //   formData,
      //   { headers: { "Content-Type": "multipart/form-data" } }
      // );
      const res = await axios.post(
  "https://time-tracker-system-production.up.railway.app/api/excel/upload",
  formData,
  { headers: { "Content-Type": "multipart/form-data" } }
);
      alert(res.data || "Excel Uploaded Successfully");

      // let the parent know so it can reload the table
      if (onUploaded) onUploaded();
    } catch (error) {
      console.log(error);
      alert(error?.response?.data || error.message || "Upload failed");
    } finally {
      // reset the input so uploading the same file again re-fires onChange
      e.target.value = "";
    }
  };

  return (
    <div className="docf-excel-actions">
      <button
        type="button"
        className="docf-btn docf-btn-ghost"
        onClick={downloadTemplate}
      >
        ⬇ Excel Template
      </button>

      <label className="docf-btn docf-btn-ghost docf-upload-label">
        ⬆ Upload Excel
        <input
          type="file"
          accept=".xlsx"
          onChange={handleUpload}
          hidden
        />
      </label>
    </div>
  );
};

export default ExcelUpload;
