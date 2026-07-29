// import React from "react";
// import ReactDOM from "react-dom/client";
// import App from "./App.jsx";
// import { BrowserRouter } from "react-router-dom";

// // import "./pages/Documents_Portal/Dashboard.css";


// ReactDOM.createRoot(document.getElementById("root")).render(
//   <BrowserRouter>
//     <App />
//   </BrowserRouter>
// );


import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { BrowserRouter } from "react-router-dom";

// ── TEMP DEBUG: catch whatever clears sessionStorage ──────────────
const _removeItem = sessionStorage.removeItem.bind(sessionStorage);
sessionStorage.removeItem = function (key) {
  console.trace("!!! sessionStorage.removeItem called for key:", key);
  return _removeItem(key);
};
const _clear = sessionStorage.clear.bind(sessionStorage);
sessionStorage.clear = function () {
  console.trace("!!! sessionStorage.clear() called");
  return _clear();
};
// ───────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);