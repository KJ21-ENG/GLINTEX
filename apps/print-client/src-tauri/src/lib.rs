use actix_cors::Cors;
use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Serialize)]
struct PrinterList {
    printers: Vec<String>,
}

#[derive(Deserialize)]
struct PrintJob {
    printer: String,
    content: String,
    #[serde(default)]
    r#type: String,
}

#[derive(Serialize, Clone)]
struct PrintJobRecord {
    id: String,
    printer: String,
    status: String, // "Processing", "Completed", "Failed"
    timestamp: String,
    error: Option<String>,
}

struct AppState {
    queue: Mutex<Vec<PrintJobRecord>>,
}

async fn list_printers() -> impl Responder {
    let platform = std::env::consts::OS;
    let mut printers = Vec::new();

    if platform == "windows" {
        let mut cmd = Command::new("powershell");
        cmd.args(&["Get-Printer", "|", "Select-Object", "Name"]);
        
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let output = cmd.output();

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<&str> = stdout.trim().split("\r\n").collect();
            if lines.len() > 2 {
                for line in lines.iter().skip(2) {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        printers.push(trimmed.to_string());
                    }
                }
            }
        }
    } else {
        // Mac/Linux
        let output = Command::new("lpstat").arg("-p").output();
        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 && parts[0] == "printer" {
                    printers.push(parts[1].to_string());
                }
            }
        }
    }

    HttpResponse::Ok().json(PrinterList { printers })
}

async fn get_queue(data: web::Data<AppState>) -> impl Responder {
    let queue = data.queue.lock().unwrap();
    HttpResponse::Ok().json(&*queue)
}

async fn print(job: web::Json<PrintJob>, data: web::Data<AppState>) -> impl Responder {
    let job_id = format!("{}", chrono::Utc::now().timestamp_millis());
    let mut record = PrintJobRecord {
        id: job_id.clone(),
        printer: job.printer.clone(),
        status: "Processing".to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        error: None,
    };

    // Add to queue
    {
        let mut queue = data.queue.lock().unwrap();
        queue.push(record.clone());
        // Keep only last 50 jobs
        if queue.len() > 50 {
            queue.remove(0);
        }
    }

    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(format!("print_job_{}.txt", job_id));

    if let Err(e) = fs::write(&file_path, &job.content) {
        return HttpResponse::InternalServerError().body(format!("Failed to write temp file: {}", e));
    }

    let platform = std::env::consts::OS;
    let status;

    if platform == "windows" {
        // Simple text print for Windows
        let mut cmd = Command::new("notepad");
        cmd.arg("/p").arg(&file_path);
        
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        status = cmd.status();
    } else {
        // Mac/Linux
        let mut cmd = Command::new("lp");
        cmd.arg("-d").arg(&job.printer);
        
        if job.r#type == "raw" {
            cmd.arg("-o").arg("raw");
        }
        
        cmd.arg(&file_path);
        status = cmd.status();
    }

    // Cleanup
    let _ = fs::remove_file(file_path);

    // Update status
    {
        let mut queue = data.queue.lock().unwrap();
        if let Some(r) = queue.iter_mut().find(|r| r.id == job_id) {
            match &status {
                Ok(s) if s.success() => {
                    r.status = "Completed".to_string();
                }
                Ok(_) => {
                    r.status = "Failed".to_string();
                    r.error = Some("Command failed".to_string());
                }
                Err(e) => {
                    r.status = "Failed".to_string();
                    r.error = Some(e.to_string());
                }
            }
        }
    }

    match status {
        Ok(s) if s.success() => HttpResponse::Ok().json(serde_json::json!({ "success": true })),
        Ok(_) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Print command failed" })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

// Global shared state
use std::sync::OnceLock;
static APP_STATE: OnceLock<web::Data<AppState>> = OnceLock::new();

fn get_app_state() -> web::Data<AppState> {
    APP_STATE.get_or_init(|| {
        web::Data::new(AppState {
            queue: Mutex::new(Vec::new()),
        })
    }).clone()
}

#[tauri::command]
fn start_server() {
    thread::spawn(|| {
        let sys = actix_web::rt::System::new();
        sys.block_on(async {
            HttpServer::new(|| {
                let cors = Cors::permissive();
                App::new()
                    .wrap(cors)
                    .app_data(get_app_state())
                    .route("/printers", web::get().to(list_printers))
                    .route("/queue", web::get().to(get_queue))
                    .route("/print", web::post().to(print))
            })
            .bind(("0.0.0.0", 9090))
            .expect("Can not bind to port 9090")
            .run()
            .await
        })
    });
}

#[tauri::command]
fn kill_existing_service() -> Result<String, String> {
    let platform = std::env::consts::OS;
    
    if platform == "windows" {
        // Find PID listening on 9090
        let mut cmd = Command::new("cmd");
        cmd.args(&["/C", "netstat -ano | findstr :9090"]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        
        let output = cmd.output().map_err(|e| e.to_string())?;
            
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(pid) = parts.last() {
                // Kill PID
                let mut kill_cmd = Command::new("taskkill");
                kill_cmd.args(&["/F", "/PID", pid]);
                #[cfg(target_os = "windows")]
                kill_cmd.creation_flags(0x08000000);
                
                let _ = kill_cmd.output();
            }
        }
    } else {
        // Mac/Linux - use lsof
        let output = Command::new("lsof")
            .args(&["-t", "-i", ":9090"])
            .output()
            .map_err(|e| e.to_string())?;
            
        let stdout = String::from_utf8_lossy(&output.stdout);
        for pid in stdout.lines() {
            if !pid.trim().is_empty() {
                let _ = Command::new("kill")
                    .arg("-9")
                    .arg(pid)
                    .output();
            }
        }
    }
    
    Ok("Service killed".to_string())
}

#[tauri::command]
fn force_start_service() -> Result<String, String> {
    let _ = kill_existing_service();
    // Give a small delay for OS to release port
    thread::sleep(std::time::Duration::from_millis(1000));
    start_server();
    Ok("Service restarted".to_string())
}

#[tauri::command]
fn stop_service_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![
            stop_service_app, 
            start_server,
            kill_existing_service,
            force_start_service
        ])
        .setup(|_app| {
            start_server();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
