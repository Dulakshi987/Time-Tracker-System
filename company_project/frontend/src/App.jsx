import { Routes, Route, Navigate } from "react-router-dom";

import Login from "./pages/Login/Login";
import IssuPrint from "./pages/Issue_Pick_Portal/IssuePickForm";
import IssuePrintForm from "./pages/Issue_Print_Portal/IssuePrintForm";
import IssueCheckForm from "./pages/Issue_Check_Portal/IssueCheckForm";
import IssueDeliveryForm from "./pages/Issue_Delivery_Portal/IssueDeliveryForm";
import ConfirmPortal from "./pages/Confirm_Portal/ConfirmPortal";
import AdminDashboard from "./pages/Admin/AdminDashboard";
import DocumentForm from "./pages/Documents_Portal/DocumentForm";

import { getCurrentUser, canAccessRoute, getDefaultRoute } from "./config/permissions";

// Blocks a route unless:
//  1. someone is logged in (sessionStorage "fentons_user"), AND
//  2. their role is allowed on this specific path (permissions.js).
// If they're logged in but their role doesn't cover this path, we send
// them to their own portal instead of the login page.
// function ProtectedRoute({ children, path }) {
//   const user = getCurrentUser();

//   if (!user) {
//     return <Navigate to="/" replace />;
//   }

//   if (!canAccessRoute(user, path)) {
//     return <Navigate to={getDefaultRoute(user)} replace />;
//   }

//   return children;
// }

function ProtectedRoute({ children, path }) {
  const user = getCurrentUser();

  console.log("=== ProtectedRoute check ===", {
    path,
    user,
    staffName: user?.staffName,
    canAccess: user ? canAccessRoute(user, path) : "no user",
  });

  if (!user) {
    console.log("BOUNCE REASON: no user in sessionStorage");
    return <Navigate to="/" replace />;
  }

  if (!canAccessRoute(user, path)) {
    console.log("BOUNCE REASON: canAccessRoute returned false, sending to", getDefaultRoute(user));
    return <Navigate to={getDefaultRoute(user)} replace />;
  }

  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />

      <Route
        path="/admin"
        element={
          <ProtectedRoute path="/admin">
            <AdminDashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/print"
        element={
          <ProtectedRoute path="/print">
            <IssuePrintForm />
          </ProtectedRoute>
        }
      />

      <Route
        path="/pick"
        element={
          <ProtectedRoute path="/pick">
            <IssuPrint />
          </ProtectedRoute>
        }
      />

      <Route
        path="/check"
        element={
          <ProtectedRoute path="/check">
            <IssueCheckForm />
          </ProtectedRoute>
        }
      />

      <Route
        path="/delivery"
        element={
          <ProtectedRoute path="/delivery">
            <IssueDeliveryForm />
          </ProtectedRoute>
        }
      />

      <Route
        path="/confirm"
        element={
          <ProtectedRoute path="/confirm">
            <ConfirmPortal />
          </ProtectedRoute>
        }
      />

      <Route
        path="/documents"
        element={
          <ProtectedRoute path="/documents">
            <DocumentForm />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
