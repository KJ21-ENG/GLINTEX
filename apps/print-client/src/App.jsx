import { useState, useEffect } from "react";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [serverStatus, setServerStatus] = useState("Checking...");
  const [autostart, setAutostart] = useState(false);
  const [printers, setPrinters] = useState([]);
  const [queue, setQueue] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    checkAutostart();
    checkServer();
    const interval = setInterval(() => {
      checkServer();
    }, 2000);
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
      setErrorMsg("Failed to change autostart. Try running as Admin.");
    }
  };

  const checkServer = async () => {
    try {
      // Check status
      const response = await fetch("http://localhost:9090/printers");
      if (response.ok) {
        setServerStatus("Online");
        const data = await response.json();
        setPrinters(data.printers || []);
        setErrorMsg("");
        
        // Fetch queue if online
        fetchQueue();
      } else {
        setServerStatus("Error");
      }
    } catch (error) {
      setServerStatus("Offline");
    }
  };

  const fetchQueue = async () => {
    try {
      const res = await fetch("http://localhost:9090/queue");
      if (res.ok) {
        const data = await res.json();
        // Sort by time desc
        setQueue(data.reverse());
      }
    } catch (e) {
      // ignore
    }
  };

  const handleStopService = async () => {
    try {
      await invoke("stop_service_app");
    } catch (error) {
      console.error("Failed to stop service:", error);
    }
  };

  const handleForceStart = async () => {
    setIsLoading(true);
    try {
      await invoke("force_start_service");
      // Wait a bit before checking again
      setTimeout(() => {
        checkServer();
        setIsLoading(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to force start:", error);
      setErrorMsg("Failed to restart service: " + error);
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>Glintex Print Service</h1>

      <div className="card">
        <h2>Service Status</h2>
        <div className={`status-indicator ${serverStatus.toLowerCase()}`}>
          <span className="status-dot"></span>
          {serverStatus}
        </div>
        <p style={{ margin: 0, color: '#666' }}>Port: 9090</p>
        
        <div className="btn-group">
          <button 
            className="btn force-btn" 
            onClick={handleForceStart}
            disabled={isLoading}
          >
            {isLoading ? "Starting..." : "Force Start"}
          </button>
          
          <button 
            className="btn restart-btn" 
            onClick={handleForceStart}
            disabled={isLoading}
          >
            Restart
          </button>
          
          <button className="btn stop-btn" onClick={handleStopService}>
            Stop App
          </button>
        </div>
        
        {errorMsg && <p className="error-text">{errorMsg}</p>}
      </div>

      <div className="card">
        <h2>Print Queue</h2>
        {queue.length > 0 ? (
          <table className="queue-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Printer</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {queue.slice(0, 5).map((job) => (
                <tr key={job.id}>
                  <td>{new Date(job.timestamp).toLocaleTimeString()}</td>
                  <td>{job.printer}</td>
                  <td>
                    <span className={`queue-status status-${job.status}`}>
                      {job.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">No recent jobs</div>
        )}
      </div>

      <div className="card">
        <h2>Configuration</h2>
        <div className="setting">
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autostart}
              onChange={toggleAutostart}
            />
            Start on System Startup
          </label>
        </div>
        
        <h3 style={{ fontSize: '0.9rem', marginTop: '1rem', marginBottom: '0.5rem', color: '#666' }}>Available Printers</h3>
        {printers.length > 0 ? (
          <ul className="printer-list">
            {printers.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: '0.8rem', color: '#999' }}>Scanning...</p>
        )}
      </div>

      <p className="footer">
        Keep this app running to enable silent printing.
      </p>
    </div>
  );
}

export default App;
