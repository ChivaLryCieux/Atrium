import { invoke } from "@tauri-apps/api/core";
import type { Project, SessionSummary } from "../types/chat";

/**
 * Aggregated project refresh payload returned by `delete_project_aggregated`:
 * one round-trip replaces the old delete → list_projects → list_sessions
 * chain (three invokes → one).
 */
export type ProjectDeletionResult = {
  projects: Project[];
  sessions: SessionSummary[];
  /** First remaining project id; the UI activates it after a deletion. */
  fallbackProjectId: string | null;
};

export async function deleteProjectAggregated(
  projectId: string,
): Promise<ProjectDeletionResult> {
  return invoke<ProjectDeletionResult>("delete_project_aggregated", { projectId });
}
