pub mod health;
#[cfg(target_os = "windows")]
pub mod job_windows;
pub mod paths;
pub mod process;

use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;

use health::{probe_health, wait_for_health, HealthOutcome};
use paths::{bridge_paths, normalize_verbatim};
use process::{debug_log, log_stream};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessConnection {
    pub status: String,
    pub url: String,
    pub port: u16,
    pub token: Option<String>,
    pub pipe: Option<String>,
    pub pid: Option<u32>,
    pub message: Option<String>,
}

impl Default for HarnessConnection {
    fn default() -> Self {
        Self {
            status: "standby".to_string(),
            url: "http://127.0.0.1:19387".to_string(),
            port: 19387,
            token: None,
            pipe: None,
            pid: None,
            message: Some("Kernel bridge not started yet".to_string()),
        }
    }
}

pub struct DshDaemon {
    pub connection: HarnessConnection,
    child: Option<Child>,
    kernel_ready: bool,
    kernel_detail: Option<String>,
    reseed_required: bool,
    #[cfg(target_os = "windows")]
    job: Option<job_windows::job::JobGuard>,
}

pub type SharedDaemon = Arc<Mutex<DshDaemon>>;

impl DshDaemon {
    pub fn new() -> Self {
        Self {
            connection: HarnessConnection::default(),
            child: None,
            kernel_ready: false,
            kernel_detail: None,
            reseed_required: false,
            #[cfg(target_os = "windows")]
            job: None,
        }
    }

    pub async fn start(&mut self, http: &reqwest::Client, app: &tauri::AppHandle) -> Result<HarnessConnection, String> {
        if self.connection.status == "ready" && self.child.is_some() {
            return Ok(self.connection.clone());
        }

        if self.connection.status == "starting" && self.child.is_some() {
            let port = self.connection.port;
            let outcome = wait_for_health(http, port, 20).await;
            self.apply_health_outcome(outcome);
            return Ok(self.connection.clone());
        }

fn is_port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

pub fn pick_bridge_port(preferred: u16) -> u16 {
    if is_port_free(preferred) {
        return preferred;
    }
    for p in (preferred + 1)..=(preferred.saturating_add(100)) {
        if is_port_free(p) {
            return p;
        }
    }
    if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", 0)) {
        if let Ok(addr) = listener.local_addr() {
            return addr.port();
        }
    }
    preferred
}

        let preferred_port: u16 = std::env::var("ATRIUM_BRIDGE_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(19387);

        let outcome = probe_health(http, preferred_port).await;
        if !matches!(outcome, HealthOutcome::Unreachable) {
            self.apply_health_outcome(outcome);
            let conn = HarnessConnection {
                status: "ready".to_string(),
                url: format!("http://127.0.0.1:{preferred_port}"),
                port: preferred_port,
                token: Some("atrium-session-token".to_string()),
                pipe: None,
                pid: None,
                message: self.connection.message.clone(),
            };
            self.connection = conn.clone();
            return Ok(conn);
        }

        let port = pick_bridge_port(preferred_port);
        debug_log(&format!("start: preferred_port={preferred_port}, chosen_port={port}"));

        let resource_dir = tauri::Manager::path(app).resource_dir().ok().map(normalize_verbatim);
        let paths = bridge_paths(resource_dir.clone());
        debug_log(&format!(
            "start: resource_dir={:?} node={} script={} dsh_root={} patch={:?} dev={}",
            resource_dir, paths.node_bin, paths.script, paths.dsh_root, paths.patch, paths.dev_root
        ));
        if !std::path::Path::new(&paths.script).exists() {
            let msg = if paths.dev_root {
                format!("kernel bridge script missing: {} (dev checkout incomplete?)", paths.script)
            } else {
                format!("kernel bridge missing from resources: {}", paths.script)
            };
            self.connection.message = Some(msg.clone());
            return Err(msg);
        }

        let workspace = tauri::Manager::path(app)
            .app_config_dir()
            .ok()
            .map(normalize_verbatim)
            .map(|d| d.to_string_lossy().to_string());

        let dynamic_token = format!("atrium-{}", uuid::Uuid::new_v4().simple());
        #[cfg(target_os = "windows")]
        let pipe_name = format!(r"\\.\pipe\atrium-bridge-{}", uuid::Uuid::new_v4().simple());

        let mut command = Command::new(&paths.node_bin);
        command
            .arg(&paths.script)
            .arg("--token").arg(&dynamic_token);

        #[cfg(target_os = "windows")]
        {
            command.arg("--pipe").arg(&pipe_name);
        }
        command
            .arg("--port").arg(port.to_string())
            .arg("--host").arg("127.0.0.1")
            .arg("--app-version").arg(env!("CARGO_PKG_VERSION"))
            .arg("--dsh-root").arg(&paths.dsh_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(patch) = &paths.patch {
            command.arg("--patch").arg(patch);
        }
        if let Some(kernel_exe) = &paths.kernel_exe {
            command.arg("--kernel-exe").arg(kernel_exe);
        }
        if let Some(workspace) = &workspace {
            command.arg("--workspace").arg(workspace);
        }

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = match command.spawn() {
            Ok(c) => c,
            Err(e) => {
                debug_log(&format!("spawn FAILED: {e}"));
                return Err(format!("无法启动内核桥接进程 ({}): {e}", paths.node_bin));
            }
        };
        debug_log("spawn OK");
        let pid = child.id();

        #[cfg(target_os = "windows")]
        {
            self.job = job_windows::job::JobGuard::assign(&child);
        }

        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || log_stream("bridge:stdout", stdout));
        }
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || log_stream("bridge:stderr", stderr));
        }

        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        let early_exit = child.try_wait().ok().flatten();
        let outcome = if let Some(status) = early_exit {
            debug_log(&format!("bridge child process exited immediately with status: {status}"));
            HealthOutcome::KernelMissing(format!("内核桥接进程启动后意外退出 ({status})"))
        } else {
            #[cfg(target_os = "windows")]
            let outcome = match crate::named_pipe_http::probe_pipe_health(&pipe_name, std::time::Duration::from_secs(20)).await {
                crate::named_pipe_http::PipeHealthOutcome::Ready => HealthOutcome::Ready,
                crate::named_pipe_http::PipeHealthOutcome::KernelMissing(detail) => HealthOutcome::KernelMissing(detail),
                crate::named_pipe_http::PipeHealthOutcome::Unreachable => wait_for_health(http, port, 20).await,
            };
            #[cfg(not(target_os = "windows"))]
            let outcome = wait_for_health(http, port, 20).await;
            outcome
        };

        self.apply_health_outcome(outcome);

        #[cfg(target_os = "windows")]
        let pipe_opt = Some(pipe_name);
        #[cfg(not(target_os = "windows"))]
        let pipe_opt = None;

        let conn = HarnessConnection {
            status: self.connection.status.clone(),
            url: format!("http://127.0.0.1:{port}"),
            port,
            token: Some(dynamic_token),
            pipe: pipe_opt,
            pid: Some(pid),
            message: self.connection.message.clone(),
        };
        self.connection = conn.clone();
        self.child = Some(child);
        Ok(conn)
    }

    pub async fn ensure_running(
        &mut self,
        http: &reqwest::Client,
        app: &tauri::AppHandle,
    ) -> Result<HarnessConnection, String> {
        if self.connection.status == "stopped" {
            return Ok(self.connection.clone());
        }
        if self.child_alive() {
            return Ok(self.connection.clone());
        }
        debug_log("ensure_running: bridge child gone — respawning");
        self.terminate_child();
        self.connection.status = "standby".to_string();
        self.connection.pid = None;
        self.kernel_ready = false;
        let result = self.start(http, app).await;
        if result.is_ok() {
            self.reseed_required = true;
        }
        result
    }

    fn child_alive(&mut self) -> bool {
        match self.child.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => self.connection.status == "ready",
        }
    }

    pub fn take_reseed_required(&mut self) -> bool {
        std::mem::take(&mut self.reseed_required)
    }

    fn apply_health_outcome(&mut self, outcome: HealthOutcome) {
        let (status, message, kernel_ready) = match outcome {
            HealthOutcome::Ready => (
                "ready",
                "Kernel bridge ready (DeepSeek Harness runtime attached)".to_string(),
                true,
            ),
            HealthOutcome::KernelMissing(detail) => (
                "ready",
                format!("内核桥接在线但 dsh 运行时缺失: {detail}"),
                false,
            ),
            HealthOutcome::Unreachable => (
                "starting",
                "Kernel bridge spawned but /healthz not answering yet".to_string(),
                false,
            ),
        };
        self.connection.status = status.to_string();
        self.connection.message = Some(message.clone());
        self.kernel_ready = kernel_ready;
        self.kernel_detail = if kernel_ready { None } else { Some(message) };
    }

    pub fn kernel_detail(&self) -> Option<&str> {
        self.kernel_detail.as_deref()
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        self.terminate_child();
        self.connection.status = "stopped".to_string();
        self.connection.pid = None;
        self.connection.message = Some("Kernel bridge stopped".to_string());
        Ok(())
    }

    fn terminate_child(&mut self) {
        #[cfg(target_os = "windows")]
        if let Some(job) = self.job.take() {
            job.terminate();
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn kernel_available(&self) -> bool {
        self.kernel_ready
    }
}

impl Drop for DshDaemon {
    fn drop(&mut self) {
        self.terminate_child();
    }
}
