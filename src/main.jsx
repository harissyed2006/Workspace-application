import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { DEMO } from "./supabase.js";
import DemoBar from "./demo/DemoBar.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    {DEMO && <DemoBar />}
  </React.StrictMode>
);
