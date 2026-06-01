import { useEffect, useState } from "react";
import axios from "axios";

import "./IssuePrint.css";

export default function IssuePrintingDocuments() {

  const [docs, setDocs] = useState([]);

  const [form, setForm] = useState({
    documentNo: "",
    customerName: "",
    reservationNo: "",
    jobwbs: "",
    enteredBy: ""
  });

  const [issueId, setIssueId] = useState(null);
  const [duration, setDuration] = useState("00:00:00");

  useEffect(() => {
    axios.get("http://localhost:8080/api/documents")
      .then(res => setDocs(res.data));
  }, []);

  // SAVE ISSUE
  const saveIssue = async () => {
    const res = await axios.post(
      "http://localhost:8080/api/issue-print/save",
      form
    );
    setIssueId(res.data.id);
  };

  // START
  const startPrint = async () => {
    const res = await axios.put(
      `http://localhost:8080/api/issue-print/start/${issueId}`
    );
    console.log("Started", res.data);
  };

  // END
  const endPrint = async () => {
    const res = await axios.put(
      `http://localhost:8080/api/issue-print/end/${issueId}`
    );

    setDuration(res.data.durationSeconds + " sec");
  };

  return (
    <div className="form-container">

      {/* DOCUMENT NO */}
      <label>Document No</label>
      <input
        placeholder="Enter Document No"
        onChange={(e) =>
          setForm({ ...form, documentNo: e.target.value })
        }
      />

      {/* CUSTOMER */}
      <label>Customer</label>
      <select
        onChange={(e) =>
          setForm({ ...form, customerName: e.target.value })
        }
      >
        <option value="">Select Customer</option>
        {docs.map((d) => (
          <option key={d.id} value={d.customerName}>
            {d.customerName}
          </option>
        ))}
      </select>

      <input
        placeholder="Or type new customer"
        onChange={(e) =>
          setForm({ ...form, customerName: e.target.value })
        }
      />

      {/* RESERVATION NO */}
      <label>Reservation No</label>
      <select
        onChange={(e) =>
          setForm({ ...form, reservationNo: e.target.value })
        }
      >
        <option value="">Select Reservation</option>
        {docs.map((d) => (
          <option key={d.id} value={d.reservationNo}>
            {d.reservationNo}
          </option>
        ))}
      </select>

      <input
        placeholder="Or type new reservation no"
        onChange={(e) =>
          setForm({ ...form, reservationNo: e.target.value })
        }
      />

      {/* JOB WBS */}
      <label>Job WBS</label>
      <select
        onChange={(e) =>
          setForm({ ...form, jobwbs: e.target.value })
        }
      >
        <option value="">Select WBS</option>
        {docs.map((d) => (
          <option key={d.id} value={d.jobwbs}>
            {d.jobwbs}
          </option>
        ))}
      </select>

      <input
        placeholder="Or type new WBS"
        onChange={(e) =>
          setForm({ ...form, jobwbs: e.target.value })
        }
      />

      {/* ENTERED BY */}
      <label>Entered By</label>
      <input
        placeholder="Enter your name"
        onChange={(e) =>
          setForm({ ...form, enteredBy: e.target.value })
        }
      />

      
      {/* START / END BUTTONS */}
      <div className="btn-row">

        <button className="start-btn" onClick={startPrint}>
          ▶ Start
        </button>

        <button className="end-btn" onClick={endPrint}>
          ⏹ End
        </button>

      </div>

      {/* DURATION */}
      <div className="duration-box">
        Duration: {duration}
      </div>

      {/* SAVE BUTTON */}
      <button className="save-btn" onClick={saveIssue}>
        Save Issue
      </button>


    </div>
  );
}