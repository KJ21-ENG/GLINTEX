import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter";
import "@fontsource/roboto-mono";
import "@fontsource/ibm-plex-sans";
import App from "./app/App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
