//! Native PTY terminals for the embedded bottom-dock panel.
//!
//! One persistent OS shell (powershell.exe on Windows, $SHELL|sh elsewhere)
//! per terminal id. Frontend drives it through Tauri commands and receives
//! output/exit over `terminal-output` / `terminal-exit` window events.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex as StdMutex};

use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub id: String,
    pub code: Option<u32>,
}

struct LiveTerminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct TerminalManager {
    pty_system: NativePtySystem,
    live: Arc<StdMutex<HashMap<String, LiveTerminal>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self { pty_system: NativePtySystem::default(), live: Arc::new(StdMutex::new(HashMap::new())) }
    }

    pub fn create(&self, app: &AppHandle, id: Option<String>, cwd: Option<String>, cols: Option<u16>, rows: Option<u16>) -> Result<TerminalInfo, String> {
        let cols = cols.unwrap_or(120).clamp(20, 500);
        let rows = rows.unwrap_or(30).clamp(5, 200);
        let id = match id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            Some(wanted) => {
                let guard = self.live.lock().map_err(|_| "终端管理器锁 poisoned".to_string())?;
                if guard.contains_key(&wanted) {
                    return Err("终端 id 已存在".to_string());
                }
                wanted
            }
            None => Uuid::new_v4().to_string(),
        };

        let resolved_cwd = match cwd.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            Some(dir) if std::path::Path::new(&dir).is_dir() => dir,
            _ => default_shell_cwd(),
        };

        let pair = self
            .pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("无法创建终端 PTY: {e}"))?;

        let mut cmd = shell_command();
        cmd.cwd(&resolved_cwd);
        cmd.env("TERM", "xterm-256color");

        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("无法启动 shell: {e}"))?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| format!("无法读取终端输出: {e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("无法写入终端输入: {e}"))?;

        {
            let mut guard = self.live.lock().map_err(|_| "终端管理器锁 poisoned".to_string())?;
            guard.insert(id.clone(), LiveTerminal { master: pair.master, writer, child });
        }

        let app_out = app.clone();
        let live_out = self.live.clone();
        let id_out = id.clone();
        std::thread::Builder::new()
            .name(format!("atrium-pty-{id_out}"))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                let mut carry = Vec::new();
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            if !carry.is_empty() {
                                let data = String::from_utf8_lossy(&carry).to_string();
                                let _ = app_out.emit("terminal-output", TerminalOutputEvent { id: id_out.clone(), data });
                            }
                            break;
                        }
                        Ok(n) => {
                            let (combined, is_borrowed) = if carry.is_empty() {
                                (&buf[..n], true)
                            } else {
                                carry.extend_from_slice(&buf[..n]);
                                (&carry[..], false)
                            };

                            let (valid_str, remaining_slice) = match std::str::from_utf8(combined) {
                                Ok(s) => (s, &[][..]),
                                Err(err) => {
                                    let valid_up_to = err.valid_up_to();
                                    if err.error_len().is_some() {
                                        let lossy = String::from_utf8_lossy(combined).to_string();
                                        carry.clear();
                                        if app_out.emit("terminal-output", TerminalOutputEvent { id: id_out.clone(), data: lossy }).is_err() {
                                            break;
                                        }
                                        continue;
                                    } else {
                                        let valid = &combined[..valid_up_to];
                                        let valid_s = match std::str::from_utf8(valid) {
                                            Ok(s) => s,
                                            Err(_) => "",
                                        };
                                        (valid_s, &combined[valid_up_to..])
                                    }
                                }
                            };

                            if !valid_str.is_empty() {
                                if app_out.emit("terminal-output", TerminalOutputEvent { id: id_out.clone(), data: valid_str.to_string() }).is_err() {
                                    break;
                                }
                            }

                            if !remaining_slice.is_empty() {
                                if is_borrowed {
                                    carry = remaining_slice.to_vec();
                                } else {
                                    let remaining_vec = remaining_slice.to_vec();
                                    carry = remaining_vec;
                                }
                            } else {
                                carry.clear();
                            }
                        }
                        Err(_) => break,
                    }
                }
                let code = live_out
                    .lock()
                    .ok()
                    .and_then(|mut guard| guard.remove(&id_out))
                    .and_then(|mut term| term.child.wait().ok())
                    .map(|status| status.exit_code());
                let _ = app_out.emit("terminal-exit", TerminalExitEvent { id: id_out, code });
            })
            .map_err(|e| format!("无法启动终端读取线程: {e}"))?;

        Ok(TerminalInfo { id, title: terminal_title(&resolved_cwd), cwd: resolved_cwd, cols, rows })
    }

    pub fn write(&self, id: &str, data: String) -> Result<(), String> {
        let mut guard = self.live.lock().map_err(|_| "终端管理器锁 poisoned".to_string())?;
        let term = guard.get_mut(id).ok_or_else(|| "终端不存在或已退出".to_string())?;
        term.writer.write_all(data.as_bytes()).map_err(|e| format!("终端写入失败: {e}"))?;
        term.writer.flush().map_err(|e| format!("终端写入失败: {e}"))?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let guard = self.live.lock().map_err(|_| "终端管理器锁 poisoned".to_string())?;
        let term = guard.get(id).ok_or_else(|| "终端不存在或已退出".to_string())?;
        term.master
            .resize(PtySize { rows: rows.clamp(5, 200), cols: cols.clamp(20, 500), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("终端尺寸调整失败: {e}"))?;
        Ok(())
    }

    pub fn close(&self, id: &str) -> Result<(), String> {
        let mut guard = self.live.lock().map_err(|_| "终端管理器锁 poisoned".to_string())?;
        if let Some(mut term) = guard.remove(id) {
            let _ = term.child.kill();
            drop(term);
        }
        Ok(())
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

fn default_shell_cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| String::from("."))
}

fn terminal_title(cwd: &str) -> String {
    let normalized = cwd.replace('\\', "/");
    let base = normalized.rsplit('/').next().unwrap_or("").trim();
    if base.is_empty() { "终端".to_string() } else { format!("终端 · {base}") }
}

#[cfg(target_os = "windows")]
fn shell_command() -> CommandBuilder {
    let shell = std::env::var("ATRIUM_SHELL").unwrap_or_else(|_| "powershell.exe".to_string());
    CommandBuilder::new(shell)
}

#[cfg(not(target_os = "windows"))]
fn shell_command() -> CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    CommandBuilder::new(shell)
}

