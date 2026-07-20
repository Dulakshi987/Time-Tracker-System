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
      <DocumentForm />
    </div>
  );
}

export default App;