pub mod fs_utils;
pub mod settings;
pub mod history;
pub mod sessions;
pub mod projects;
pub mod souls;

pub use fs_utils::config_dir;
#[allow(unused_imports)]
pub use settings::{
    create_profile, default_profile, default_settings, delete_profile, load_settings,
    normalize_settings, save_settings, seed_models,
};
pub use history::{clear_history, load_history, save_history};
#[allow(unused_imports)]
pub use sessions::{
    civil_from_days, create_session_in_project, delete_session, find_session,
    generate_session_title, list_sessions, load_session_messages, rename_session,
    save_session_index, save_session_messages, SessionSummary, SessionSummaryTitle,
};
pub use projects::{
    create_project, delete_project, delete_project_aggregated, ensure_projects, load_projects,
    normalize_project, update_project, ProjectDeletionResult,
};
#[allow(unused_imports)]
pub use souls::{
    create_soul, delete_soul, ensure_souls, list_souls, load_active_soul_content, save_soul,
    Soul, SoulMeta, DEFAULT_SOUL_FOLDER,
};
