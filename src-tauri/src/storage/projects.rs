use std::{fs, path::PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

use crate::models::Project;
use super::fs_utils::{atomic_write, config_dir, now_secs};
use super::sessions::{list_sessions, save_session_index, SessionSummary};

const PROJECTS_FILE: &str = "projects.json";

fn projects_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(PROJECTS_FILE))
}

pub fn load_projects(app: &AppHandle) -> Result<Vec<Project>, String> {
    let path = projects_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("无法读取项目列表: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("项目列表格式无效: {e}"))
}

fn save_projects(app: &AppHandle, projects: &[Project]) -> Result<(), String> {
    let path = projects_path(app)?;
    let text = serde_json::to_string_pretty(projects).map_err(|e| format!("序列化项目失败: {e}"))?;
    atomic_write(&path, &text)
}

/// Guarantee at least one project exists and every session belongs to one.
/// Legacy sessions (no project) are migrated into the default project.
pub fn ensure_projects(app: &AppHandle) -> Result<Vec<Project>, String> {
    let mut projects = load_projects(app)?;
    let mut changed = false;

    if projects.is_empty() {
        let fallback_dir = config_dir(app)?.to_string_lossy().to_string();
        let default_project = Project {
            id: Uuid::new_v4().to_string(),
            name: "初始空间".to_string(),
            description: "自动创建的初始工作空间".to_string(),
            directories: vec![fallback_dir.clone()],
            default_directory: Some(fallback_dir),
            created_at: now_secs(),
        };
        projects.push(default_project);
        changed = true;
    } else {
        for p in projects.iter_mut() {
            if p.name == "默认项目" {
                p.name = "初始空间".to_string();
                if p.description == "自动创建的默认工作项目" {
                    p.description = "自动创建的初始工作空间".to_string();
                }
                changed = true;
            }
        }
    }

    if changed {
        save_projects(app, &projects)?;
    }

    let default_id = projects[0].id.clone();
    let mut sessions = list_sessions(app).unwrap_or_default();
    let migrated = sessions
        .iter_mut()
        .filter(|s| s.project_id.is_none())
        .map(|s| {
            s.project_id = Some(default_id.clone());
        })
        .count();
    if migrated > 0 {
        save_session_index(app, &sessions)?;
    }

    Ok(projects)
}

pub fn create_project(
    app: &AppHandle,
    name: &str,
    description: &str,
    directories: Vec<String>,
    default_directory: Option<String>,
) -> Result<Project, String> {
    let mut projects = load_projects(app)?;
    let fallback_dir = config_dir(app)?.to_string_lossy().to_string();

    let mut directories = directories
        .into_iter()
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .collect::<Vec<_>>();
    if directories.is_empty() {
        directories.push(fallback_dir);
    }

    let default_directory = default_directory
        .filter(|d| directories.iter().any(|x| x == d))
        .or_else(|| directories.first().cloned());

    let project = Project {
        id: Uuid::new_v4().to_string(),
        name: if name.trim().is_empty() { format!("项目{}", projects.len() + 1) } else { name.trim().to_string() },
        description: description.trim().to_string(),
        directories,
        default_directory,
        created_at: now_secs(),
    };
    projects.push(project.clone());
    save_projects(app, &projects)?;
    Ok(project)
}

pub fn update_project(app: &AppHandle, project: Project) -> Result<Project, String> {
    let mut projects = load_projects(app)?;
    let Some(entry) = projects.iter_mut().find(|p| p.id == project.id) else {
        return Err(format!("项目不存在: {}", project.id));
    };
    *entry = project.clone();
    save_projects(app, &projects)?;
    Ok(project)
}

pub fn delete_project(app: &AppHandle, project_id: &str) -> Result<(), String> {
    let mut projects = load_projects(app)?;
    let Some(index) = projects.iter().position(|p| p.id == project_id) else {
        return Err(format!("项目不存在: {project_id}"));
    };
    if projects.len() <= 1 {
        return Err("至少需要保留一个项目".to_string());
    }
    projects.remove(index);
    let fallback_id = projects[0].id.clone();

    let mut sessions = list_sessions(app)?;
    let mut migrated = 0usize;
    for session in sessions.iter_mut() {
        if session.project_id.as_deref() == Some(project_id) {
            session.project_id = Some(fallback_id.clone());
            migrated += 1;
        }
    }
    if migrated > 0 {
        save_session_index(app, &sessions)?;
    }

    save_projects(app, &projects)?;

    let mut metrics = crate::tokens::load_metrics(app);
    metrics.projects.retain(|p| p.project_id != project_id);
    let _ = crate::tokens::save_metrics(app, &metrics);

    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeletionResult {
    pub projects: Vec<Project>,
    pub sessions: Vec<SessionSummary>,
    pub fallback_project_id: Option<String>,
}

pub fn delete_project_aggregated(
    app: &AppHandle,
    project_id: &str,
) -> Result<ProjectDeletionResult, String> {
    let mut projects = load_projects(app)?;
    let Some(index) = projects.iter().position(|p| p.id == project_id) else {
        return Err(format!("项目不存在: {project_id}"));
    };
    if projects.len() <= 1 {
        return Err("至少需要保留一个项目".to_string());
    }
    projects.remove(index);
    let fallback_id = projects[0].id.clone();

    let mut sessions = list_sessions(app)?;
    let mut migrated = 0usize;
    for session in sessions.iter_mut() {
        if session.project_id.as_deref() == Some(project_id) {
            session.project_id = Some(fallback_id.clone());
            migrated += 1;
        }
    }
    if migrated > 0 {
        save_session_index(app, &sessions)?;
    }

    save_projects(app, &projects)?;

    let mut metrics = crate::tokens::load_metrics(app);
    metrics.projects.retain(|p| p.project_id != project_id);
    let _ = crate::tokens::save_metrics(app, &metrics);

    Ok(ProjectDeletionResult {
        projects,
        sessions,
        fallback_project_id: Some(fallback_id),
    })
}

pub fn normalize_project(mut project: Project) -> Project {
    project.name = project.name.trim().to_string();
    project.description = project.description.trim().to_string();

    let mut seen = std::collections::HashSet::new();
    project.directories = project
        .directories
        .iter()
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty() && seen.insert(d.clone()))
        .collect();

    project.default_directory = project
        .default_directory
        .take()
        .filter(|d| project.directories.iter().any(|x| x == d))
        .or_else(|| project.directories.first().cloned());
    project
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_project_trims_and_deduplicates() {
        let p = Project {
            id: "test".to_string(),
            name: "  My Project  ".to_string(),
            description: "  desc  ".to_string(),
            directories: vec![
                " C:\\repo ".to_string(),
                "C:\\repo".to_string(),
                "".to_string(),
                "   ".to_string(),
            ],
            default_directory: Some("C:\\repo".to_string()),
            created_at: 0,
        };
        let normalized = normalize_project(p);
        assert_eq!(normalized.name, "My Project");
        assert_eq!(normalized.description, "desc");
        assert_eq!(normalized.directories, vec!["C:\\repo".to_string()]);
        assert_eq!(normalized.default_directory, Some("C:\\repo".to_string()));
    }
}
