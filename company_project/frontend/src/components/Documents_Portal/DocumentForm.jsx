import { useState, useEffect } from "react";
import axios from "axios";
import { createDocument } from "../../services/Documents_Portal/api";

const DocumentForm = ({ selectedType }) => {

  // Current Date
  const getCurrentDate = () => {
    return new Date().toISOString().split("T")[0];
  };

  // Current Time
  const getCurrentTime = () => {
    return new Date().toLocaleTimeString();
  };

  // Form State
  const [formData, setFormData] = useState({
    jobType: selectedType,
    jobWBS: "",
    reservationNo: "",
    customerName: "",
    enteredBy: "",
    requestDate: "",
    requestTime: "",
    Date: getCurrentDate(),
    Time: getCurrentTime(),
    status: "Empty"
  });

  // Update Job Type
  useEffect(() => {

    setFormData(prev => ({
      ...prev,
      jobType: selectedType
    }));

  }, [selectedType]);

  // Real-Time Clock
  // useEffect(() => {

  //   const timer = setInterval(() => {

  //     setFormData(prev => ({
  //       ...prev,
  //       requestDate: getCurrentDate(),
  //       requestTime: getCurrentTime()
  //     }));

  //   }, 1000);

  //   return () => clearInterval(timer);

  // }, []);

  // Input Change
  const handleChange = (e) => {

    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });

  };

  // Save Form
  const handleSubmit = async (e) => {

  e.preventDefault();

  const payload = {
    ...formData,
    jobType: selectedType,
    status: "Print Pending"
  };

  console.log(payload);

  try {

    const res = await createDocument(payload);

    console.log(res.data);

    alert("Saved Successfully");

  } catch (error) {

    console.log(error);

  }
};

  // Download Excel Template
  const downloadTemplate = () => {

    window.open(
      "http://localhost:8080/api/excel/download-template"
    );

  };

  // Upload Excel
 const handleExcelUpload = async (e) => {

  const file = e.target.files[0];

  const formData = new FormData();

  formData.append("file", file);

  try {

    const res = await axios.post(
      "http://localhost:8080/api/excel/upload",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data"
        }
      }
    );

    alert(res.data);

  } catch (error) {

    console.log(error);

  }
};

  return (

    <div className="form-container">

      <h2 className="form-title">
        {selectedType} Document Form
      </h2>

      {/* EXCEL SECTION */}

      <div className="excel-section">

        <button
          className="download-btn"
          onClick={downloadTemplate}
        >
          Download Excel Format
        </button>

        <input
          type="file"
          accept=".xlsx"
          onChange={handleExcelUpload}
          className="excel-upload"
        />

      </div>

      {/* FORM */}

      <form onSubmit={handleSubmit}>

        <div className="form-grid">

          <input
            type="text"
            value={selectedType}
            readOnly
            className="form-input readonly-input"
          />

          <input
            type="text"
            name="jobWBS"
            placeholder="Job WBS"
            value={formData.jobWBS}
            onChange={handleChange}
            className="form-input"
          />

          <input
            type="text"
            name="reservationNo"
            placeholder="Reservation No"
            value={formData.reservationNo}
            onChange={handleChange}
            className="form-input"
          />

          <input
            type="text"
            name="customerName"
            placeholder="Customer Name"
            value={formData.customerName}
            onChange={handleChange}
            className="form-input"
          />

          <input
            type="text"
            name="enteredBy"
            placeholder="Entered Person Name"
            value={formData.enteredBy}
            onChange={handleChange}
            className="form-input"
          />


        <input
          type="date"
          value={formData.requestDate}
          onChange={(e) =>
            setFormData({
              ...formData,
              requestDate: e.target.value
            })
          }
          className="form-input"
        />

        <input
        type="time"
        value={formData.requestTime}
        onChange={(e) =>
          setFormData({
            ...formData,
            requestTime: e.target.value
          })
        }
        className="form-input"
      />

          <input
            type="text"
            value={formData.status}
            readOnly
            className="form-input status-input"
          />

        </div>

        <button type="submit" className="save-btn">
          Save Document
        </button>

      </form>

    </div>
  );
};


// if (doc.getRequestDate() == null || doc.getRequestTime() == null) {
//     return ResponseEntity.badRequest()
//             .body("Date and Time required");
// }
export default DocumentForm;