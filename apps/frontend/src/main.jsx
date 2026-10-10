import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter";
import "@fontsource/inter/700.css";
import "@fontsource/roboto-mono";
import "@fontsource/roboto-mono/700.css";
import "@fontsource/ibm-plex-sans";
import "@fontsource/ibm-plex-sans/700.css";
// Label text is measured with these faces; print embeds the same files, so bold must be real here too.
import App from "./app/App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
