import { useEffect, useState } from "react";
import axios from "axios";

const SummaryCards = () => {

  const [data, setData] = useState([]);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {

    try {

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

      setData(counts);

    } catch (error) {
      console.log(error);
    }
  };

  return (
    <div style={{ display: "flex", gap: 10 }}>
      {Object.keys(data).map(k => (
        <div key={k} style={{ padding: 10 }}>
          <h3>{k}</h3>
          <p>{data[k]}</p>
        </div>
      ))}
    </div>
  );
};

export default SummaryCards;