import IssuPrint from "./pages/Issue_Pick_Portal/IssuePickForm";
import IssuePrintForm from "./pages/Issue_Print_Portal/IssuePrintForm";
import IssueCheckForm from "./pages/Issue_Check_Portal/IssueCheckForm";

function App() {
  return (
    <div>
      <IssuPrint />
      <IssuePrintForm />
      <IssueCheckForm />
    </div>
  );
}

export default App;