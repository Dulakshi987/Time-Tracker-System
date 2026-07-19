import { useEffect, useState } from "react";
import axios from "axios";
import "./SummaryCards.css";

const SummaryCards = () => {

  const [data, setData] = useState({
    All:0,
    Commercial: 0,
    Balance: 0,
    "Cost Center": 0,
    Domestic: 0,
    "Sales Order": 0
  });

  useEffect(() => {
    load();
  }, []);

  const load = async () => {

    const res = await axios.get(
      "http://localhost:8080/api/documents"
    );

    const counts = {
      Commercial: 0,
      Balance: 0,
      "Cost Center": 0,
      Domestic: 0,
      "Sales Order": 0
    };

    res.data.forEach(d => {
      if (counts[d.jobType] !== undefined) {
        counts[d.jobType]++;
      }
    });

    setData({ ...counts });
  };

  return (
    <div className="summary-container">

      {Object.keys(data).map((k, index) => (
        <div key={index} className="summary-card">

          <h3 className="card-title">{k}</h3>

          <p className="card-value">{data[k]}</p>

        </div>
      ))}

    </div>
  );
};

export default SummaryCards;