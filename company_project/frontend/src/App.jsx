// import IssuPrint from "./pages/Issue_Pick_Portal/IssuePickForm";
// import IssuePrintForm from "./pages/Issue_Print_Portal/IssuePrintForm";
// import IssueCheckForm from "./pages/Issue_Check_Portal/IssueCheckForm";
// import IssueDeliveryForm from "./pages/Issue_Delivery_Portal/IssueDeliveryForm";
// import ConfirmPortal from "./pages/Confirm_Portal/ConfirmPortal";
// import AdminDashboard from "./pages/Admin/AdminDashboard";
// import DocumentForm from "./pages/Documents_Portal/DocumentForm";


// function App() {

//   return (
//     <div>
//       <IssuePrintForm />
//       <IssuPrint />
//       <IssueCheckForm />
//       <IssueDeliveryForm />
//       <ConfirmPortal />
//       <AdminDashboard />
//       <DocumentForm />
//     </div>
//   );
// }

// export default App;


import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Login from "./pages/Login/Login";
import IssuPrint from "./pages/Issue_Pick_Portal/IssuePickForm";
import IssuePrintForm from "./pages/Issue_Print_Portal/IssuePrintForm";
import IssueCheckForm from "./pages/Issue_Check_Portal/IssueCheckForm";
import IssueDeliveryForm from "./pages/Issue_Delivery_Portal/IssueDeliveryForm";
import ConfirmPortal from "./pages/Confirm_Portal/ConfirmPortal";
import AdminDashboard from "./pages/Admin/AdminDashboard";
import DocumentForm from "./pages/Documents_Portal/DocumentForm";

// Blocks access to admin routes unless a login (sessionStorage
// "fentons_user", set by Login.jsx on successful sign-in) is present.
function ProtectedRoute({ children }) {
  const user = sessionStorage.getItem("fentons_user");
  if (!user) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />

        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        <Route path="/print" element={<IssuePrintForm />} />
        <Route path="/pick" element={<IssuPrint />} />
        <Route path="/check" element={<IssueCheckForm />} />
        <Route path="/delivery" element={<IssueDeliveryForm />} />
        <Route path="/confirm" element={<ConfirmPortal />} />
        <Route path="/documents" element={<DocumentForm />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
