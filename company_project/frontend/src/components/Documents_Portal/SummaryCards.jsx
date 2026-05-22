import { useEffect, useState } from "react";
import { getDocuments } from "../../services/Documents_Portal/api";

const SummaryCards = () => {

  const [data, setData] = useState({});

  useEffect(() => {
    load();
  }, []);

  const load = async () => {

    const res = await getDocuments();

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
  };

  return (

    <div className="summary-grid">

      {Object.keys(data).map((key, index) => (

        <div
          key={index}
          className="summary-box"
        >

          <h3>{key}</h3>
          <h1>{data[key]}</h1>

        </div>

      ))}

    </div>
  );
};

export default SummaryCards;