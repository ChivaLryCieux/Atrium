use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
mod job {
    //! Windows Job Object wrapper: every process the bridge spawns (dsh
    //! runtimes) joins the job, and terminating/closing the job kills the
    //! whole tree — `Child::kill` alone would orphan the grandchildren.

    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        SetInformationJobObject, TerminateJobObject,
    };

    pub struct JobGuard {
        handle: HANDLE,
    }

    // A HANDLE is a kernel integer handle, not a pointer into process memory:
    // moving or sharing it across threads is sound.
    unsafe impl Send for JobGuard {}
    unsafe impl Sync for JobGuard {}

    impl JobGuard {
        /// Create a kill-on-close job and assign `child` to it. Returns None
        /// when the OS refuses (the child then lives outside the job and is
        /// cleaned up by the plain `Child::kill` fallback).
        pub fn assign(child: &Child) -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if (handle as isize) == 0 {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) == 0
                {
                    CloseHandle(handle);
                    return None;
                }
                let raw = child.as_raw_handle();
                if AssignProcessToJobObject(handle, raw as _) == 0 {
                    CloseHandle(handle);
                    return None;
                }
                Some(Self { handle })
            }
        }

        pub fn terminate(&self) {
            unsafe {
                TerminateJobObject(self.handle, 0);
            }
        }
    }

    impl Drop for JobGuard {
        fn drop(&mut self) {
            // The last closed job handle kills any surviving job members.
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessConnection {
    pub status: String,
    pub url: String,
    pub port: u16,
    pub token: Option<String>,
    pub pid: Option<u32>,
    pub message: Option<String>,
}

impl Default for HarnessConnection {
    fn default() -> Self {
        Self {
            status: "standby".to_string(),
            url: "http://127.0.0.1:19387".to_string(),
            port: 19387,
            token: Some("atrium-session-token".to_string()),
            pid: None,
            message: Some("Kernel bridge not started yet".to_string()),
        }
    }
}

pub struct DshDaemon {
    pub connection: HarnessConnection,
    child: Option<Child>,
    /// Whether the bridge reported the dsh runtime itself as ready. Kept
    /// separate from `connection.status`: a reachable bridge with a missing
    /// kernel (packaged light builds) must route turns to the direct API.
    kernel_ready: bool,
    #[cfg(target_os = "windows")]
    job: Option<job::JobGuard>,
}

/// Result of probing the bridge's /healthz endpoint.
enum HealthOutcome {
    /// Bridge up and the dsh runtime underneath it is usable.
    Ready,
    /// Bridge up but the kernel is absent or failed to load; the payload is
    /// the bridge's own diagnostic detail.
    KernelMissing(String),
    /// No answer at all (still booting, port dead).
    Unreachable,
}

/// Filesystem layout of the Atrium kernel bridge, resolved for both dev and
/// packaged runs.
struct BridgePaths {
    node_bin: String,
    script: String,
    dsh_root: String,
    patch: Option<String>,
    /// Dev-checkout root for reference only; None when resolved from resources.
    dev_root: bool,
}

fn bridge_paths(resource_dir: Option<PathBuf>) -> BridgePaths {
    // Explicit env overrides win in every layout (dev/testing escape hatch).
    let env = |key: &str| std::env::var(key).ok().filter(|v| !v.is_empty());

    // Dev builds: the workspace layout relative to the compiled crate.
    let dev_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf());

    // Packaged runs: `bundle-runtime.mjs` stages the runtime under
    // src-tauri/resources/, which Tauri extracts into the resource dir:
    //   <res>/bridge/index.cjs   self-contained kernel bridge (esbuild)
    //   <res>/kernel/            vendored deepseek-harness runtime tree
    //   <res>/cordis/atrium-sdk.cordis.patch.yml
    //   <res>/node/node.exe      bundled node runtime
    //
    // Debug builds never take this route: `tauri dev` copies the (small) dev
    // resources into target/debug, which would otherwise masquerade as an
    // installed layout and point the kernel at a non-existent copy.
    let packaged = resource_dir
        .filter(|_| !cfg!(debug_assertions))
        .filter(|dir| dir.join("bridge/index.cjs").exists());

    if let Some(res) = packaged {
        let node = env("ATRIUM_NODE_BIN").unwrap_or_else(|| res.join("node/node.exe").to_string_lossy().to_string());
        return BridgePaths {
            node_bin: node,
            script: env("ATRIUM_BRIDGE_SCRIPT").unwrap_or_else(|| res.join("bridge/index.cjs").to_string_lossy().to_string()),
            dsh_root: env("ATRIUM_DSH_ROOT").unwrap_or_else(|| res.join("kernel").to_string_lossy().to_string()),
            patch: env("ATRIUM_KERNEL_PATCH").or_else(|| res.join("cordis/atrium-sdk.cordis.patch.yml").exists().then(|| res.join("cordis/atrium-sdk.cordis.patch.yml").to_string_lossy().to_string())),
            dev_root: false,
        };
    }

    let root = dev_root.unwrap_or_default();
    let script_default = root.join("packages/aria-desktop-host/src/index.js");
    let dsh_default = root.join("deepseek-harness");
    let patch_default = root.join("packages/aria-core/profiles/aria-desktop/atrium-sdk.cordis.patch.yml");
    BridgePaths {
        node_bin: env("ATRIUM_NODE_BIN").unwrap_or_else(|| "node".to_string()),
        script: env("ATRIUM_BRIDGE_SCRIPT").unwrap_or_else(|| script_default.to_string_lossy().to_string()),
        dsh_root: env("ATRIUM_DSH_ROOT").unwrap_or_else(|| dsh_default.to_string_lossy().to_string()),
        patch: env("ATRIUM_KERNEL_PATCH").or_else(|| patch_default.exists().then(|| patch_default.to_string_lossy().to_string())),
        dev_root: true,
    }
}

/// Strip the `\\?\` / `\\?\UNC\` verbatim prefix Windows APIs (and thus
/// Tauri's path resolver) attach to returned paths. Child processes — node
/// especially — cannot use verbatim paths as script/cwd arguments.
fn normalize_verbatim(path: PathBuf) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{unc}"))
    } else if let Some(plain) = text.strip_prefix(r"\\?\") {
        PathBuf::from(plain.to_string())
    } else {
        path
    }
}

impl DshDaemon {
    pub fn new() -> Self {
        Self {
            connection: HarnessConnection::default(),
            child: None,
            kernel_ready: false,
            #[cfg(target_os = "windows")]
            job: None,
        }
    }

    /// Spawn the `@aria/desktop-host` kernel bridge and wait until it answers
    /// `/healthz`. The bridge owns the real dsh runtime; it spawns lazily on
    /// the first turn, so startup here is fast even before the kernel boots.
    pub async fn start(&mut self, http: &reqwest::Client, app: &tauri::AppHandle) -> Result<HarnessConnection, String> {
        if self.connection.status == "ready" && self.child.is_some() {
            return Ok(self.connection.clone());
        }

        // A previous spawn is still booting ("starting"): wait on the existing
        // bridge instead of stacking a second node process on the same port.
        if self.connection.status == "starting" && self.child.is_some() {
            let port = self.connection.port;
            let outcome = Self::wait_for_health(http, port, 20).await;
            self.apply_health_outcome(outcome);
            return Ok(self.connection.clone());
        }

        let port: u16 = std::env::var("ATRIUM_BRIDGE_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(19387);

        // An already-running bridge (hot reload, previous run) is good enough.
        let outcome = Self::probe_health(http, port).await;
        if !matches!(outcome, HealthOutcome::Unreachable) {
            self.apply_health_outcome(outcome);
            let conn = HarnessConnection {
                status: "ready".to_string(),
                url: format!("http://127.0.0.1:{port}"),
                port,
                token: Some("atrium-session-token".to_string()),
                pid: None,
                message: self.connection.message.clone(),
            };
            self.connection = conn.clone();
            return Ok(conn);
        }

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

        let mut command = Command::new(&paths.node_bin);
        command
            .arg(&paths.script)
            .arg("--port").arg(port.to_string())
            .arg("--host").arg("127.0.0.1")
            .arg("--dsh-root").arg(&paths.dsh_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(patch) = &paths.patch {
            command.arg("--patch").arg(patch);
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

        // The bridge and every dsh runtime it spawns join one job object, so
        // teardown removes the whole tree instead of orphaning grandchildren.
        #[cfg(target_os = "windows")]
        {
            self.job = job::JobGuard::assign(&child);
        }

        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || log_stream("bridge:stdout", stdout));
        }
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || log_stream("bridge:stderr", stderr));
        }

        let outcome = Self::wait_for_health(http, port, 20).await;
        self.apply_health_outcome(outcome);

        let conn = HarnessConnection {
            status: self.connection.status.clone(),
            url: format!("http://127.0.0.1:{port}"),
            port,
            token: Some("atrium-session-token".to_string()),
            pid: Some(pid),
            message: self.connection.message.clone(),
        };
        self.connection = conn.clone();
        self.child = Some(child);
        Ok(conn)
    }

    /// Translate a health-probe outcome into the connection state.
    fn apply_health_outcome(&mut self, outcome: HealthOutcome) {
        let (status, message, kernel_ready) = match outcome {
            HealthOutcome::Ready => (
                "ready",
                "Kernel bridge ready (DeepSeek Harness runtime attached)".to_string(),
                true,
            ),
            HealthOutcome::KernelMissing(detail) => (
                // The bridge itself is fine; the kernel route is what is
                // unavailable, and the direct-API fallback covers turns.
                "ready",
                format!("内核桥接在线但 dsh 运行时缺失，将回退直连通道: {detail}"),
                false,
            ),
            HealthOutcome::Unreachable => (
                "starting",
                "Kernel bridge spawned but /healthz not answering yet".to_string(),
                false,
            ),
        };
        self.connection.status = status.to_string();
        self.connection.message = Some(message);
        self.kernel_ready = kernel_ready;
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        self.terminate_child();
        self.connection.status = "stopped".to_string();
        self.connection.pid = None;
        self.connection.message = Some("Kernel bridge stopped".to_string());
        Ok(())
    }

    /// Kill the bridge process tree (job object first, direct child as the
    /// non-Windows / fallback path), then release both handles.
    fn terminate_child(&mut self) {
        #[cfg(target_os = "windows")]
        if let Some(job) = self.job.take() {
            job.terminate();
            // Drop closes the job handle; KILL_ON_JOB_CLOSE sweeps survivors.
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Whether agent turns should attempt the kernel route. True only when
    /// the bridge answered /healthz with the dsh runtime itself ready — a
    /// reachable bridge without a kernel must NOT route turns.
    pub fn kernel_available(&self) -> bool {
        self.kernel_ready
    }

    async fn probe_health(http: &reqwest::Client, port: u16) -> HealthOutcome {
        let url = format!("http://127.0.0.1:{port}/healthz");
        let probe = async {
            let resp = http.get(&url).send().await.ok()?;
            if !resp.status().is_success() {
                return None;
            }
            let body: serde_json::Value = resp.json().await.ok()?;
            let kernel = body.get("kernel").and_then(|v| v.as_str())?.to_string();
            let detail = body
                .get("detail")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            Some((kernel, detail))
        };
        match tokio::time::timeout(std::time::Duration::from_millis(1200), probe).await {
            Ok(Some((kernel, _detail))) if kernel == "ready" => HealthOutcome::Ready,
            Ok(Some((kernel, detail))) => HealthOutcome::KernelMissing(format!("{kernel}: {detail}")),
            _ => HealthOutcome::Unreachable,
        }
    }

    async fn wait_for_health(http: &reqwest::Client, port: u16, seconds: u64) -> HealthOutcome {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(seconds);
        loop {
            match Self::probe_health(http, port).await {
                HealthOutcome::Ready => return HealthOutcome::Ready,
                // A definitive kernel verdict (missing/error) is final for
                // this bridge instance; only "starting" keeps polling.
                HealthOutcome::KernelMissing(detail)
                    if detail.starts_with("missing") || detail.starts_with("error") =>
                {
                    return HealthOutcome::KernelMissing(detail)
                }
                _ => {}
            }
            if tokio::time::Instant::now() >= deadline {
                return HealthOutcome::Unreachable;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }
}

fn log_stream(tag: &str, stream: impl std::io::Read + Send + 'static) {
    let reader = BufReader::new(stream);
    for line in reader.lines().map_while(Result::ok) {
        eprintln!("[{tag}] {line}");
    }
}

/// Step-by-step daemon diagnostics to %TEMP%\atrium_daemon_debug.log — the
/// only sink visible in packaged (windowed) runs.
fn debug_log(line: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join("atrium_daemon_debug.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
    }
}

/// Shared handle used by Tauri commands.
pub type SharedDaemon = Arc<Mutex<DshDaemon>>;

impl Drop for DshDaemon {
    fn drop(&mut self) {
        self.terminate_child();
    }
}
