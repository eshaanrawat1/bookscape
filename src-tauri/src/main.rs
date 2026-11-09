#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
  net::{SocketAddr, TcpStream},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  thread,
  time::{Duration, Instant},
};

use rand::{distributions::Alphanumeric, Rng};
use reqwest::blocking::Client;
use tauri::Manager;

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 9876;
const HEALTHCHECK_URL: &str = "http://127.0.0.1:9876/health";
const TOKEN_ENV_VAR: &str = "BOOKSCAPE_API_TOKEN";
const TOKEN_HEADER: &str = "X-Bookscape-Token";
const TOKEN_LEN: usize = 43;

fn project_root() -> &'static Path {
  Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
}

/// Handed to the webview so its fetches can prove they come from the app.
struct ApiToken(String);

#[tauri::command]
fn api_token(token: tauri::State<'_, ApiToken>) -> String {
  token.0.clone()
}

/// Fresh each launch, so a backend left over from an earlier run can't answer for this one.
fn generate_token() -> String {
  rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(TOKEN_LEN)
    .map(char::from)
    .collect()
}

fn backend_addr() -> SocketAddr {
  SocketAddr::from(([127, 0, 0, 1], BACKEND_PORT))
}

struct BackendGuard(Child);

impl Drop for BackendGuard {
  fn drop(&mut self) {
    let _ = self.0.kill();
  }
}

fn is_backend_listening() -> bool {
  TcpStream::connect_timeout(&backend_addr(), Duration::from_millis(200)).is_ok()
}

fn kill_backend_listener() {
  #[cfg(any(target_os = "macos", target_os = "linux"))]
  {
    let output = Command::new("lsof")
      .args(["-tiTCP:9876", "-sTCP:LISTEN"])
      .output();

    let Ok(output) = output else {
      return;
    };

    if !output.status.success() {
      return;
    }

    let pids = String::from_utf8_lossy(&output.stdout);
    for pid in pids.lines().filter_map(|line| line.trim().parse::<i32>().ok()) {
      let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
  }
}

fn resolve_python() -> PathBuf {
  let candidates = [
    project_root().join("backend/.venv/bin/python"),
    project_root().join("backend/.venv/bin/python3"),
    project_root().join("backend/venv/bin/python"),
    project_root().join("backend/venv/bin/python3"),
    project_root().join("backend/.venv/Scripts/python.exe"),
    project_root().join("backend/.venv/Scripts/python3.exe"),
    project_root().join("backend/venv/Scripts/python.exe"),
    project_root().join("backend/venv/Scripts/python3.exe"),
  ];

  for candidate in candidates.iter() {
    if candidate.exists() {
      return candidate.clone();
    }
  }

  // Falls back to PATH so a local virtualenv isn't required in development.
  #[cfg(windows)]
  {
    PathBuf::from("python")
  }

  #[cfg(not(windows))]
  {
    PathBuf::from("python3")
  }
}

fn launch_backend(token: &str) -> std::io::Result<Child> {
  if is_backend_listening() {
    kill_backend_listener();
    let deadline = Instant::now() + Duration::from_secs(5);
    while is_backend_listening() && Instant::now() < deadline {
      thread::sleep(Duration::from_millis(50));
    }
  }

  Command::new(resolve_python())
    .current_dir(project_root())
    .env(TOKEN_ENV_VAR, token)
    .args([
      "-m",
      "uvicorn",
      "backend.app.main:app",
      "--host",
      BACKEND_HOST,
      "--port",
    ])
    .arg(BACKEND_PORT.to_string())
    .stdin(Stdio::null())
    .stdout(Stdio::inherit())
    .stderr(Stdio::inherit())
    .spawn()
}

fn wait_for_backend(token: &str) -> bool {
  let client = match Client::builder().timeout(Duration::from_secs(2)).build() {
    Ok(client) => client,
    Err(error) => {
      eprintln!("failed to build health-check HTTP client: {error}");
      return false;
    }
  };

  let deadline = Instant::now() + Duration::from_secs(30);

  while Instant::now() < deadline {
    if let Ok(response) = client.get(HEALTHCHECK_URL).header(TOKEN_HEADER, token).send() {
      if response.status().is_success() {
        // Give the backend a moment to finish wiring up every route.
        thread::sleep(Duration::from_millis(500));
        return true;
      }
    }

    thread::sleep(Duration::from_millis(250));
  }

  false
}

fn show_main_window(app: tauri::AppHandle) {
  if let Some(window) = app.get_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
  }
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![api_token])
    .setup(|app| {
      if let Some(window) = app.get_window("main") {
        let _ = window.hide();
      }

      // First, because the backend, health checks and webview all depend on it.
      let token = generate_token();
      app.manage(ApiToken(token.clone()));

      match launch_backend(&token) {
        Ok(backend) => {
          app.manage(BackendGuard(backend));
        }
        Err(error) => {
          eprintln!("failed to launch backend: {error}");
          show_main_window(app.handle());
          return Ok(());
        }
      }

      let app_handle = app.handle();
      thread::spawn(move || {
        if wait_for_backend(&token) {
          show_main_window(app_handle);
        } else {
          eprintln!("backend health check timed out");
          show_main_window(app_handle);
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
