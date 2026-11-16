import React from "react";
import ReactDOM from "react-dom/client";
import { WikiApp } from "./WikiApp";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WikiApp />
  </React.StrictMode>,
);
