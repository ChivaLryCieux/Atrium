use std::path::PathBuf;

pub struct BridgePaths {
    pub node_bin: String,
    pub script: String,
    pub dsh_root: String,
    pub patch: Option<String>,
    pub kernel_exe: Option<String>,
    pub dev_root: bool,
}

pub fn kernel_exe_in(dir: &std::path::Path) -> Option<String> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("deepseek-harness-sdk-runtime-")
            && name.ends_with(".exe")
            && !name.ends_with("-rg.exe")
            && entry.path().is_file()
        {
            return Some(entry.path().to_string_lossy().to_string());
        }
    }
    None
}

pub fn bridge_paths(resource_dir: Option<PathBuf>) -> BridgePaths {
    let env = |key: &str| std::env::var(key).ok().filter(|v| !v.is_empty());

    let dev_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf());

    let packaged = resource_dir
        .filter(|_| !cfg!(debug_assertions))
        .filter(|dir| dir.join("bridge/index.cjs").exists());

    if let Some(res) = packaged {
        let node = env("ATRIUM_NODE_BIN").unwrap_or_else(|| res.join("node/node.exe").to_string_lossy().to_string());
        let kernel_dir = res.join("kernel");
        return BridgePaths {
            node_bin: node,
            script: env("ATRIUM_BRIDGE_SCRIPT").unwrap_or_else(|| res.join("bridge/index.cjs").to_string_lossy().to_string()),
            dsh_root: env("ATRIUM_DSH_ROOT").unwrap_or_else(|| kernel_dir.to_string_lossy().to_string()),
            patch: env("ATRIUM_KERNEL_PATCH").or_else(|| res.join("cordis/atrium-sdk.cordis.patch.yml").exists().then(|| res.join("cordis/atrium-sdk.cordis.patch.yml").to_string_lossy().to_string())),
            kernel_exe: env("ATRIUM_KERNEL_EXE").or_else(|| kernel_exe_in(&kernel_dir)),
            dev_root: false,
        };
    }

    let root = dev_root.unwrap_or_default();
    let script_default = root.join("packages/atrium-desktop-host/src/index.js");
    let dsh_default = root.join("deepseek-harness");
    let patch_default = root.join("packages/atrium-core/profiles/atrium-desktop/atrium-sdk.cordis.patch.yml");
    BridgePaths {
        node_bin: env("ATRIUM_NODE_BIN").unwrap_or_else(|| "node".to_string()),
        script: env("ATRIUM_BRIDGE_SCRIPT").unwrap_or_else(|| script_default.to_string_lossy().to_string()),
        dsh_root: env("ATRIUM_DSH_ROOT").unwrap_or_else(|| dsh_default.to_string_lossy().to_string()),
        patch: env("ATRIUM_KERNEL_PATCH").or_else(|| patch_default.exists().then(|| patch_default.to_string_lossy().to_string())),
        kernel_exe: env("ATRIUM_KERNEL_EXE"),
        dev_root: true,
    }
}

pub fn normalize_verbatim(path: PathBuf) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{unc}"))
    } else if let Some(plain) = text.strip_prefix(r"\\?\") {
        PathBuf::from(plain.to_string())
    } else {
        path
    }
}
