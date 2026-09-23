use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// ─── Data Types ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_submodule: bool,
    pub current_branch: String,
    pub tracking_branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub staged: bool,
    pub status: String, // "M", "A", "D", "?", "R", "U"
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoStatus {
    pub repo_info: GitRepoInfo,
    pub files: Vec<GitFileStatus>,
    pub is_clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub relative_date: String,
    pub summary: String,
    pub refs: Vec<String>,
    pub is_head: bool,
}

// ─── Helper Functions ──────────────────────────────────────────

pub fn run_git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(dir);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let output = cmd.output().map_err(|e| format!("执行 git 失败: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        let out = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(if !err.trim().is_empty() { err } else { out });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn get_branch_info(repo_dir: &Path) -> (String, Option<String>, usize, usize) {
    let branch = run_git(repo_dir, &["branch", "--show-current"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let current_branch = if branch.is_empty() {
        // Detached HEAD or initial commit
        run_git(repo_dir, &["rev-parse", "--short", "HEAD"])
            .map(|s| format!("HEAD ({})", s.trim()))
            .unwrap_or_else(|_| "HEAD".to_string())
    } else {
        branch
    };

    let tracking_branch = run_git(repo_dir, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut ahead = 0;
    let mut behind = 0;

    if tracking_branch.is_some() {
        if let Ok(counts) = run_git(repo_dir, &["rev-list", "--left-right", "--count", "HEAD...@{u}"]) {
            let parts: Vec<&str> = counts.trim().split_whitespace().collect();
            if parts.len() == 2 {
                ahead = parts[0].parse::<usize>().unwrap_or(0);
                behind = parts[1].parse::<usize>().unwrap_or(0);
            }
        }
    }

    (current_branch, tracking_branch, ahead, behind)
}

fn build_repo_info(repo_dir: &Path, is_submodule: bool) -> Option<GitRepoInfo> {
    if !repo_dir.join(".git").exists() {
        return None;
    }

    let name = repo_dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".to_string());
    let path_str = repo_dir.to_string_lossy().to_string();
    let (current_branch, tracking_branch, ahead, behind) = get_branch_info(repo_dir);

    Some(GitRepoInfo {
        id: format!("{}-{}", name, path_str.len()),
        name,
        path: path_str,
        is_submodule,
        current_branch,
        tracking_branch,
        ahead,
        behind,
    })
}

// ─── Public API ────────────────────────────────────────────────

pub fn init_repo(repo_path: &str) -> Result<GitRepoInfo, String> {
    let dir = Path::new(repo_path);
    if !dir.exists() {
        return Err(format!("目录不存在: {repo_path}"));
    }
    run_git(dir, &["init"])?;
    build_repo_info(dir, false).ok_or_else(|| "初始化 Git 仓库后未能解析仓库信息".to_string())
}

pub fn detect_repos(project_path: &str) -> Result<Vec<GitRepoInfo>, String> {
    let root = Path::new(project_path);
    if !root.exists() {
        return Err(format!("项目路径不存在: {project_path}"));
    }

    let mut repos = Vec::new();

    // 1. Check if the project root itself is a git repository
    if let Some(root_info) = build_repo_info(root, false) {
        repos.push(root_info);
    }

    // 2. Scan immediate subdirectories for nested repos (submodules / vendored repos)
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let subpath = entry.path();
            if subpath.is_dir() && subpath != root.join(".git") {
                if let Some(sub_info) = build_repo_info(&subpath, true) {
                    repos.push(sub_info);
                }
            }
        }
    }

    Ok(repos)
}

pub fn get_repo_status(repo_path: &str) -> Result<GitRepoStatus, String> {
    let dir = Path::new(repo_path);
    if !dir.exists() {
        return Err(format!("仓库目录不存在: {repo_path}"));
    }

    let repo_info = build_repo_info(dir, false)
        .ok_or_else(|| format!("非有效 Git 仓库: {repo_path}"))?;

    let output = run_git(dir, &["status", "--porcelain=v1", "-uall"])?;
    let mut files = Vec::new();

    for line in output.lines() {
        if line.len() < 3 {
            continue;
        }

        let x = line.chars().next().unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let rest = line[3..].trim();

        let (old_path, file_path) = if rest.contains(" -> ") {
            let parts: Vec<&str> = rest.split(" -> ").collect();
            (Some(parts[0].to_string()), parts[1].to_string())
        } else {
            (None, rest.to_string())
        };

        if x == '?' && y == '?' {
            // Untracked
            files.push(GitFileStatus {
                path: file_path,
                staged: false,
                status: "?".to_string(),
                old_path: None,
            });
        } else {
            // Staged part
            if x != ' ' && x != '?' {
                files.push(GitFileStatus {
                    path: file_path.clone(),
                    staged: true,
                    status: x.to_string(),
                    old_path: old_path.clone(),
                });
            }
            // Unstaged part
            if y != ' ' && y != '?' {
                files.push(GitFileStatus {
                    path: file_path,
                    staged: false,
                    status: y.to_string(),
                    old_path,
                });
            }
        }
    }

    let is_clean = files.is_empty();

    Ok(GitRepoStatus {
        repo_info,
        files,
        is_clean,
    })
}

/// One scan result per detected repository. `status` stays `None` when the
/// repo could not be read (e.g. git missing) and `error` carries the reason,
/// so a single unreadable repo never fails the whole panel load.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoSnapshot {
    pub info: GitRepoInfo,
    pub status: Option<GitRepoStatus>,
    pub error: Option<String>,
}

/// Detect repositories under a project directory *with* their working-tree
/// status in one call. Replaces the frontend's detect-then-N×status loop
/// (1 + N invokes → 1).
pub fn detect_repos_with_status(project_path: &str) -> Result<Vec<GitRepoSnapshot>, String> {
    let repos = detect_repos(project_path)?;
    let snapshots = repos
        .into_iter()
        .map(|info| {
            let path = info.path.clone();
            match get_repo_status(&path) {
                Ok(status) => GitRepoSnapshot {
                    info,
                    status: Some(status),
                    error: None,
                },
                Err(err) => GitRepoSnapshot {
                    info,
                    status: None,
                    error: Some(err),
                },
            }
        })
        .collect();
    Ok(snapshots)
}

pub fn stage_file(repo_path: &str, file_path: &str) -> Result<(), String> {
    run_git(Path::new(repo_path), &["add", "--", file_path])?;
    Ok(())
}

pub fn unstage_file(repo_path: &str, file_path: &str) -> Result<(), String> {
    // Reset file from index
    let _ = run_git(Path::new(repo_path), &["restore", "--staged", "--", file_path])
        .or_else(|_| run_git(Path::new(repo_path), &["reset", "HEAD", "--", file_path]));
    Ok(())
}

pub fn stage_all(repo_path: &str) -> Result<(), String> {
    run_git(Path::new(repo_path), &["add", "-A"])?;
    Ok(())
}

pub fn unstage_all(repo_path: &str) -> Result<(), String> {
    let _ = run_git(Path::new(repo_path), &["restore", "--staged", "."])
        .or_else(|_| run_git(Path::new(repo_path), &["reset", "HEAD"]));
    Ok(())
}

pub fn discard_file(repo_path: &str, file_path: &str) -> Result<(), String> {
    let path = Path::new(repo_path);
    // Check if it's untracked
    let status = run_git(path, &["status", "--porcelain=v1", "--", file_path])?;
    if status.starts_with("??") {
        let full = path.join(file_path);
        if full.is_file() {
            fs::remove_file(&full).map_err(|e| format!("删除未跟踪文件失败: {e}"))?;
        } else if full.is_dir() {
            fs::remove_dir_all(&full).map_err(|e| format!("删除未跟踪目录失败: {e}"))?;
        }
        return Ok(());
    }

    // Unstage first if needed, then restore working tree
    let _ = run_git(path, &["restore", "--staged", "--", file_path]);
    run_git(path, &["restore", "--", file_path])?;
    Ok(())
}

pub fn commit(repo_path: &str, message: &str) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("提交说明不能为空".to_string());
    }
    let output = run_git(Path::new(repo_path), &["commit", "-m", message])?;
    Ok(output)
}

pub fn push(repo_path: &str) -> Result<String, String> {
    run_git(Path::new(repo_path), &["push"])
}

pub fn pull(repo_path: &str) -> Result<String, String> {
    run_git(Path::new(repo_path), &["pull"])
}

pub fn fetch(repo_path: &str) -> Result<String, String> {
    run_git(Path::new(repo_path), &["fetch"])
}

pub fn get_log(repo_path: &str, max_count: Option<usize>) -> Result<Vec<GitCommit>, String> {
    let dir = Path::new(repo_path);
    let count = max_count.unwrap_or(50).to_string();

    let head_hash = run_git(dir, &["rev-parse", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    // Format: Hash, ShortHash, Parents, AuthorName, AuthorEmail, RelativeDate, Subject, Refs
    // Separator between fields: \x00; Separator between commits: \x1e
    let output = run_git(
        dir,
        &[
            "log",
            "-n",
            &count,
            "--date=relative",
            "--pretty=format:%H%x00%h%x00%P%x00%an%x00%ae%x00%ar%x00%s%x00%D%x1e",
        ],
    )?;

    let mut commits = Vec::new();

    for record in output.split('\x1e') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }

        let fields: Vec<&str> = record.split('\x00').collect();
        if fields.len() < 8 {
            continue;
        }

        let hash = fields[0].to_string();
        let short_hash = fields[1].to_string();
        let parents = fields[2]
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();
        let author_name = fields[3].to_string();
        let author_email = fields[4].to_string();
        let relative_date = fields[5].to_string();
        let summary = fields[6].to_string();
        let refs_str = fields[7].trim();

        let refs = if refs_str.is_empty() {
            Vec::new()
        } else {
            refs_str
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        };

        let is_head = !head_hash.is_empty() && hash == head_hash;

        commits.push(GitCommit {
            hash,
            short_hash,
            parents,
            author_name,
            author_email,
            relative_date,
            summary,
            refs,
            is_head,
        });
    }

    Ok(commits)
}

pub fn get_diff(repo_path: &str, file_path: &str, staged: bool) -> Result<String, String> {
    let dir = Path::new(repo_path);
    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(file_path);

    let output = run_git(dir, &args)?;
    if output.trim().is_empty() {
        // If untracked file, read the whole content
        let full = dir.join(file_path);
        if full.is_file() {
            if let Ok(content) = fs::read_to_string(&full) {
                return Ok(format!("--- /dev/null\n+++ b/{file_path}\n@@ -0,0 +1,{} @@\n{}", content.lines().count(), content));
            }
        }
    }
    Ok(output)
}
