import { useState } from "react";
import "./ChartFilter.css";

function ChartFilter({ onFilter }) {

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const handleFilter = () => {
    onFilter(fromDate, toDate);
  };

  const clearFilter = () => {
    setFromDate("");
    setToDate("");
    onFilter("", "");
  };

  return (
    <center>
    <div className="chart-filter" >
 
      <div className="filter-group" >
       
        <label>From Date</label>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
      
      </div>

      <div className="filter-group">
        <label>To Date</label>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
      </div>

      <button
        className="filter-btn"
        onClick={handleFilter}
      >
        Apply Filter
      </button>

      <button
        className="reset-btn"
        onClick={clearFilter}
      >
        Reset
      </button>

    </div>
    </center>
  );
}

export default ChartFilter;