use actix_cors::Cors;
use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::process::Command;
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

async fn print(job: web::Json<PrintJob>) -> impl Responder {
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(format!("print_job_{}.txt", chrono::Utc::now().timestamp_millis()));

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

    match status {
        Ok(s) if s.success() => HttpResponse::Ok().json(serde_json::json!({ "success": true })),
        Ok(_) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": "Print command failed" })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

fn start_server() {
    thread::spawn(|| {
        let sys = actix_web::rt::System::new();
        sys.block_on(async {
            HttpServer::new(|| {
                let cors = Cors::permissive();
                App::new()
                    .wrap(cors)
                    .route("/printers", web::get().to(list_printers))
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
        .invoke_handler(tauri::generate_handler![stop_service_app])
        .setup(|app| {
            start_server();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
