import { useState } from "react";

import Sidebar from "./components/Documents_Portal/Sidebar";
import SummaryCards from "./components/Documents_Portal/SummaryCards";
import DocumentForm from "./components/Documents_Portal/DocumentForm";
import DocumentList from "./components/Documents_Portal/DocumentList";
import ExcelUpload from "./components/Documents_Portal/ExcelUpload";
import DashboardChart from "./pages/Documents_Portal/DashboardChart";
import ChartFilter from "./pages/Documents_Portal/ChartFilter";

function App() {

  const [selectedType, setSelectedType] = useState("Summary");

  const [chartFilter, setChartFilter] = useState({
    fromDate: "",
    toDate: ""
  });

  const handleFilter = (fromDate, toDate) => {
    setChartFilter({ fromDate, toDate });
  };

  return (
    <div className="dashboard-container">

      <Sidebar setSelectedType={setSelectedType} />

      <div className="main-content">

        <div className="topbar">
          <h1>Documents Portal</h1>
        </div>

        {selectedType === "Summary" && (
          <>
            <SummaryCards />

            <ChartFilter onFilter={handleFilter} />

            <DashboardChart chartFilter={chartFilter} />

            <DocumentList
              selectedType="All"
              chartFilter={chartFilter}
            />
          </>
        )}

        {selectedType !== "Summary" && (
          <>
            <DocumentForm selectedType={selectedType} />
            <DocumentList selectedType={selectedType} />
            <ExcelUpload />
          </>
        )}

      </div>
    </div>
  );
}

export default App;