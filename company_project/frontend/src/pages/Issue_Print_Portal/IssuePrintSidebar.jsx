import "./IssuePrint.css";

function IssuePrintSidebar({
  setSelectedMenu
}) {
  return (
    <div className="sidebar">

      <h2>Issue Print</h2>

      <ul>

        <li
          onClick={() =>
            setSelectedMenu("SummaryPrinting")
          }
        >
          Summary Printing
        </li>

        <li
          onClick={() =>
            setSelectedMenu(
              "IssuePrintingDocuments"
            )
          }
        >
          Issue Printing Documents
        </li>

      </ul>

    </div>
  );
}

export default IssuePrintSidebar;