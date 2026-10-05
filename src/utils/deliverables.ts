import { ToolCallItem } from "../types/chat";

export type DeliverableFileKind = "created" | "modified" | "deleted" | "executed";

export interface DeliverableItem {
  id: string;
  path: string;
  filename: string;
  kind: DeliverableFileKind;
  toolName: string;
  callId: string;
  turn?: number;
  step?: number;
  contentSnippet?: string;
  timestamp?: number;
  diffSummary?: {
    oldString?: string;
    newString?: string;
  };
}

/**
 * Extracts produced or modified deliverables from tool call records.
 * Catches DSH and coding agent tool conventions:
 * - write_to_file, write, write_file, create_file
 * - replace_file_content, edit, str_replace_editor, apply_patch, patch
 * - delete_file, rm, remove_file
 */
export function extractDeliverablesFromToolCalls(
  toolCalls?: ToolCallItem[] | null
): DeliverableItem[] {
  if (!toolCalls || toolCalls.length === 0) return [];

  const items: DeliverableItem[] = [];
  const seenPaths = new Set<string>();

  for (const call of toolCalls) {
    if (call.status === "error") continue; // Skip failed mutations

    let parsedArgs: Record<string, any> = {};
    try {
      if (typeof call.arguments === "string") {
        parsedArgs = JSON.parse(call.arguments);
      } else if (typeof call.arguments === "object" && call.arguments !== null) {
        parsedArgs = call.arguments;
      }
    } catch {
      continue;
    }

    const name = call.name.toLowerCase();
    let rawPath: string | null = null;
    let kind: DeliverableFileKind = "modified";
    let snippet: string | undefined = undefined;
    let diff: { oldString?: string; newString?: string } | undefined = undefined;

    // Detect file path and mutation kind
    if (name === "write_to_file" || name === "write" || name === "create_file" || name === "write_file") {
      rawPath = parsedArgs.TargetFile || parsedArgs.target_file || parsedArgs.targetFile || parsedArgs.file_path || parsedArgs.path || parsedArgs.filePath;
      kind = parsedArgs.Overwrite === false ? "modified" : "created";
      if (typeof parsedArgs.CodeContent === "string") {
        snippet = parsedArgs.CodeContent.slice(0, 300);
      } else if (typeof parsedArgs.content === "string") {
        snippet = parsedArgs.content.slice(0, 300);
      }
    } else if (name === "replace_file_content" || name === "edit" || name === "apply_patch" || name === "patch") {
      rawPath = parsedArgs.TargetFile || parsedArgs.target_file || parsedArgs.targetFile || parsedArgs.file_path || parsedArgs.path || parsedArgs.filePath;
      kind = "modified";
      const oldStr = parsedArgs.TargetContent || parsedArgs.old_string || parsedArgs.old_str;
      const newStr = parsedArgs.ReplacementContent || parsedArgs.new_string || parsedArgs.new_str;
      if (oldStr || newStr) {
        diff = {
          oldString: typeof oldStr === "string" ? oldStr : undefined,
          newString: typeof newStr === "string" ? newStr : undefined,
        };
      }
    } else if (name === "str_replace_editor") {
      rawPath = parsedArgs.path || parsedArgs.file_path;
      if (parsedArgs.command === "create") {
        kind = "created";
        if (typeof parsedArgs.file_text === "string") snippet = parsedArgs.file_text.slice(0, 300);
      } else if (parsedArgs.command === "str_replace" || parsedArgs.command === "insert") {
        kind = "modified";
        diff = {
          oldString: typeof parsedArgs.old_str === "string" ? parsedArgs.old_str : undefined,
          newString: typeof parsedArgs.new_str === "string" ? parsedArgs.new_str : undefined,
        };
      }
    } else if (name === "delete_file" || name === "rm" || name === "remove_file") {
      rawPath = parsedArgs.TargetFile || parsedArgs.target_file || parsedArgs.path || parsedArgs.filePath;
      kind = "deleted";
    }

    if (rawPath && typeof rawPath === "string") {
      const trimmed = rawPath.trim();
      if (trimmed.length > 0) {
        // Standardize filename
        const parts = trimmed.split(/[\\/]/);
        const filename = parts[parts.length - 1] || trimmed;

        const deliverableKey = `${trimmed}:${kind}`;
        if (!seenPaths.has(deliverableKey)) {
          seenPaths.add(deliverableKey);
          items.push({
            id: call.id || `deliv-${items.length}`,
            path: trimmed,
            filename,
            kind,
            toolName: call.name,
            callId: call.id,
            turn: call.turn,
            step: call.step,
            contentSnippet: snippet,
            timestamp: call.timestamp || Date.now(),
            diffSummary: diff,
          });
        }
      }
    }
  }

  return items;
}
