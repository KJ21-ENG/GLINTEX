import { useState, useEffect } from "react";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
import "./App.css";

function App() {
  const [serverStatus, setServerStatus] = useState("Checking...");
  const [autostart, setAutostart] = useState(false);
  const [printers, setPrinters] = useState([]);

  useEffect(() => {
    checkAutostart();
    checkServer();
    const interval = setInterval(checkServer, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkAutostart = async () => {
    try {
      const enabled = await isEnabled();
      setAutostart(enabled);
    } catch (error) {
      console.error("Failed to check autostart:", error);
    }
  };

  const toggleAutostart = async () => {
    try {
      if (autostart) {
        await disable();
        setAutostart(false);
      } else {
        await enable();
        setAutostart(true);
      }
    } catch (error) {
      console.error("Failed to toggle autostart:", error);
      alert("Failed to change autostart settings. You might need to run as admin.");
    }
  };

  const checkServer = async () => {
    try {
      const response = await fetch("http://localhost:9090/printers");
      if (response.ok) {
        setServerStatus("Online");
        const data = await response.json();
        setPrinters(data.printers || []);
      } else {
        setServerStatus("Error");
      }
    } catch (error) {
      setServerStatus("Offline");
    }
  };

  return (
    <div className="container">
      <h1>Local Print Service</h1>

      <div className="card">
        <h2>Status</h2>
        <div className={`status-indicator ${serverStatus.toLowerCase()}`}>
          <span className="status-dot"></span>
          {serverStatus}
        </div>
        <p>Port: 9090</p>
      </div>

      <div className="card">
        <h2>Configuration</h2>
        <div className="setting">
          <label>
            <input
              type="checkbox"
              checked={autostart}
              onChange={toggleAutostart}
            />
            Start on System Startup
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Available Printers</h2>
        {printers.length > 0 ? (
          <ul className="printer-list">
            {printers.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p>No printers found or service offline.</p>
        )}
      </div>

      <p className="footer">
        Keep this app running to enable silent printing from the web app.
      </p>
    </div>
  );
}

export default App;
