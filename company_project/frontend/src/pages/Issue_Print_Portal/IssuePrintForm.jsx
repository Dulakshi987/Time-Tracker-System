import { useEffect, useState } from "react";
import axios from "axios";

import "./IssuePrint.css"


export default function IssuePrintForm() {

  const [docs, setDocs] = useState([]);

  const [form, setForm] = useState({
    customerName: "",
    reservationNo: "",
    jobwbs: ""
  });

  useEffect(() => {
    axios.get("http://localhost:8080/api/documents")
      .then(res => setDocs(res.data));
  }, []);

  return (
    <div className="form-container">

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

    </div>
  );
}