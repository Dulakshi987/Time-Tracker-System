import "../../pages/Issue_Print_Portal/IssuePrint.css";

function SummaryPrinting() {
  return (
    <>
      <div className="cards">

        <div className="card">
          <h3>Total Prints</h3>
          <p>125</p>
        </div>

        <div className="card">
          <h3>Active Prints</h3>
          <p>15</p>
        </div>

        <div className="card">
          <h3>Reservations</h3>
          <p>10</p>
        </div>

      </div>

      <h2>Printing Statistics</h2>

      {/* Chart Component */}
    </>
  );
}

export default SummaryPrinting;