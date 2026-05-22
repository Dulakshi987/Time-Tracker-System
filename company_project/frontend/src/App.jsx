import { useState } from "react";

import Sidebar from "./components/Documents_Portal/Sidebar";
import SummaryCards from "./components/Documents_Portal/SummaryCards";
import DocumentForm from "./components/Documents_Portal/DocumentForm";
import DocumentList from "./components/Documents_Portal/DocumentList";
import ExcelUpload from "./components/Documents_Portal/ExcelUpload";

function App() {

  const [selectedType, setSelectedType] = useState("Summary");

  return (

    <div className="dashboard-container">

      <Sidebar setSelectedType={setSelectedType} />

      <div className="main-content">

        {/* TOP BAR */}
        <div className="topbar">
          <h1 className="typewriter">
            Welcome! Documents Entering Portal
          </h1>
        </div>

        {/* SUMMARY DASHBOARD */}
        {selectedType === "Summary" && (
          <>
            <SummaryCards />



            {/* TABLE */}
            <DocumentList selectedType="All" />
          </>
        )}

        {/* FORM + LIST */}
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