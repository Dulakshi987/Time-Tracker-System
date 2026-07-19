import IssuPrint from "./pages/Issue_Pick_Portal/IssuePickForm";
import IssuePrintForm from "./pages/Issue_Print_Portal/IssuePrintForm";
import IssueCheckForm from "./pages/Issue_Check_Portal/IssueCheckForm";
import IssueDeliveryForm from "./pages/Issue_Delivery_Portal/IssueDeliveryForm";
import ConfirmPortal from "./pages/Confirm_Portal/ConfirmPortal";
import AdminDashboard from "./pages/Admin/AdminDashboard";
import DocumentForm from "./pages/Documents_Portal/DocumentForm";




function App() {
  return (
    <div>
      
      <IssuePrintForm />
      <IssuPrint />
      <IssueCheckForm />
      <IssueDeliveryForm />
      <ConfirmPortal />
      <AdminDashboard />
      <DocumentForm/>
    </div>
  );
}

export default App;







// import { useState } from "react";

// import Sidebar from "./components/Documents_Portal/Sidebar";
// import SummaryCards from "./components/Documents_Portal/SummaryCards";
// import DocumentForm from "./components/Documents_Portal/DocumentForm";
// import DocumentList from "./components/Documents_Portal/DocumentList";
// import ExcelUpload from "./components/Documents_Portal/ExcelUpload";

// function App() {

//   const [selectedType, setSelectedType] = useState("Summary");

//   return (

//     <div className="dashboard-container">

//       <Sidebar setSelectedType={setSelectedType} />

//       <div className="main-content">

//         {/* TOP BAR */}
//         <div className="topbar">
//           <h1 className="typewriter">
//             Welcome! Documents Entering Portal
//           </h1>
//         </div>

//         {/* SUMMARY DASHBOARD */}
//         {selectedType === "Summary" && (
//           <>
//             <SummaryCards />



//             {/* TABLE */}
//             <DocumentList selectedType="All" />
//           </>
//         )}

//         {/* FORM + LIST */}
//         {selectedType !== "Summary" && (
//           <>
//             <DocumentForm selectedType={selectedType} />
//             <DocumentList selectedType={selectedType} />
//             <ExcelUpload />
//           </>
//         )}

//       </div>

//     </div>
//   );
// }

// export default App;