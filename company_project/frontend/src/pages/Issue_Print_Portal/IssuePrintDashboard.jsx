import { useState } from "react";
import IssuePrintSidebar from "./IssuePrintSidebar";
import SummaryPrinting from "../../components/Issue_Print_Portal/SummaryPrinting";
import IssuePrintingDocuments from "./IssuePrintingDocuments";
import "./IssuePrint.css";

function IssuePrintDashboard() {

  const [selectedMenu, setSelectedMenu] =
    useState("SummaryPrinting");

  return (
    <div className="dashboard-container">

      <IssuePrintSidebar
        setSelectedMenu={setSelectedMenu}
      />

      <div className="main-content">

        <div className="topbar">
          <h1>Issue Print Portal</h1>
        </div>

        {selectedMenu === "SummaryPrinting" && (
          <SummaryPrinting />
        )}

        {selectedMenu === "IssuePrintingDocuments" && (
          <IssuePrintingDocuments />
        )}

      </div>

    </div>
  );
}

export default IssuePrintDashboard;