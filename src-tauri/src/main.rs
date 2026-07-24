#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
  net::{SocketAddr, TcpStream},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::{Arc, Mutex},
  thread,
  time::{Duration, Instant},
};

use reqwest::blocking::Client;
use tauri::Manager;

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 9876;
const HEALTHCHECK_URL: &str = "http://127.0.0.1:9876/health";
const EXPECTED_BACKEND_API_VERSION: u64 = 3;

fn project_root() -> &'static Path {
  Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
}

fn backend_addr() -> SocketAddr {
  SocketAddr::from(([127, 0, 0, 1], BACKEND_PORT))
}

struct BackendGuard(Arc<Mutex<Option<Child>>>);

impl Drop for BackendGuard {
  fn drop(&mut self) {
    if let Ok(mut guard) = self.0.lock() {
      if let Some(mut child) = guard.take() {
        let _ = child.kill();
      }
    }
  }
}

fn is_backend_listening() -> bool {
  TcpStream::connect_timeout(&backend_addr(), Duration::from_millis(200)).is_ok()
}

fn backend_is_current() -> bool {
  let client = match Client::builder().timeout(Duration::from_secs(2)).build() {
    Ok(client) => client,
    Err(_) => return false,
  };

  let response = match client.get(HEALTHCHECK_URL).send() {
    Ok(response) => response,
    Err(_) => return false,
  };

  if !response.status().is_success() {
    return false;
  }

  match response.json::<serde_json::Value>() {
    Ok(payload) => payload
      .get("backend_api_version")
      .and_then(|value| value.as_u64())
      .map(|version| version == EXPECTED_BACKEND_API_VERSION)
      .unwrap_or(false),
    Err(_) => false,
  }
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

fn resolve_python() -> Option<PathBuf> {
  let candidates = [
    project_root().join(".venv/bin/python"),
    project_root().join(".venv/bin/python3"),
    project_root().join("venv/bin/python"),
    project_root().join("venv/bin/python3"),
    project_root().join(".venv/Scripts/python.exe"),
    project_root().join(".venv/Scripts/python3.exe"),
    project_root().join("venv/Scripts/python.exe"),
    project_root().join("venv/Scripts/python3.exe"),
  ];

  for candidate in candidates.iter() {
    if candidate.exists() {
      return Some(candidate.clone());
    }
  }

  // Fall back to PATH lookups so a local virtualenv is not the only way
  // the desktop app can start the backend during development.
  #[cfg(windows)]
  {
    return Some(PathBuf::from("python"));
  }

  #[cfg(not(windows))]
  {
    return Some(PathBuf::from("python3"));
  }
}

fn launch_backend() -> std::io::Result<Option<Child>> {
  eprintln!("[Rust] launch_backend: starting");
  
  if is_backend_listening() {
    eprintln!("[Rust] launch_backend: backend already listening");
    if backend_is_current() {
      eprintln!("[Rust] launch_backend: backend is current, skipping launch");
      return Ok(None);
    }

    eprintln!("[Rust] launch_backend: killing old backend listener");
    kill_backend_listener();
    thread::sleep(Duration::from_millis(500));
  }

  let python = resolve_python().ok_or_else(|| {
    eprintln!("[Rust] launch_backend: failed to resolve Python interpreter");
    std::io::Error::new(std::io::ErrorKind::NotFound, "could not find a Python interpreter")
  })?;

  eprintln!("[Rust] launch_backend: resolved Python path: {:?}", python);
  eprintln!("[Rust] launch_backend: project root: {:?}", project_root());
  eprintln!("[Rust] launch_backend: spawning uvicorn command");

  let child = Command::new(python)
    .current_dir(project_root())
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
    .spawn();

  match &child {
    Ok(_) => eprintln!("[Rust] launch_backend: successfully spawned backend process"),
    Err(e) => eprintln!("[Rust] launch_backend: failed to spawn backend: {}", e),
  }

  let child = child?;

  Ok(Some(child))
}

fn wait_for_backend() -> bool {
  eprintln!("[Rust] wait_for_backend: starting health check loop");
  
  let client = match Client::builder().timeout(Duration::from_secs(2)).build() {
    Ok(client) => client,
    Err(e) => {
      eprintln!("[Rust] wait_for_backend: failed to build HTTP client: {}", e);
      return false;
    }
  };

  let deadline = Instant::now() + Duration::from_secs(30);
  let mut attempts = 0;
  
  while Instant::now() < deadline {
    attempts += 1;
    eprintln!("[Rust] wait_for_backend: health check attempt {} (URL: {})", attempts, HEALTHCHECK_URL);
    
    if let Ok(response) = client.get(HEALTHCHECK_URL).send() {
      eprintln!("[Rust] wait_for_backend: got response status: {}", response.status());
      if response.status().is_success() {
        eprintln!("[Rust] wait_for_backend: health check successful");
        // Add a small delay to ensure backend is fully ready to handle all endpoints
        eprintln!("[Rust] wait_for_backend: waiting for backend to fully initialize");
        thread::sleep(Duration::from_millis(500));
        eprintln!("[Rust] wait_for_backend: backend initialization delay complete");
        return true;
      }
    } else {
      eprintln!("[Rust] wait_for_backend: health check request failed");
    }
    
    thread::sleep(Duration::from_millis(250));
  }

  eprintln!("[Rust] wait_for_backend: health check timed out after {} attempts", attempts);
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
    .setup(|app| {
      if let Some(window) = app.get_window("main") {
        let _ = window.hide();
      }

      let backend = launch_backend();
      if let Err(error) = &backend {
        eprintln!("failed to launch backend: {error}");
        show_main_window(app.handle());
        return Ok(());
      }

      let backend = backend?;
      app.manage(BackendGuard(Arc::new(Mutex::new(backend))));

      let app_handle = app.handle();
      thread::spawn(move || {
        if wait_for_backend() {
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
