/**
 * Per-task composer draft persistence.
 *
 * Drafts are keyed by session id; the pre-session "home" state shares one
 * well-known key so an unsent message survives navigating into a task and
 * back, as well as app restarts. Storage failures (quota, private mode)
 * degrade to in-memory-only drafting — never throw into the render path.
 */

const STORAGE_KEY = "atrium.drafts.v1";
const HOME_KEY = "__home__";

type DraftMap = Record<string, string>;

function readMap(): DraftMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: DraftMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

function writeMap(map: DraftMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — drafts stay in-memory for this run */
  }
}

export function draftKeyFor(sessionId: string | null): string {
  return sessionId ?? HOME_KEY;
}

export function loadDraft(sessionId: string | null): string {
  return readMap()[draftKeyFor(sessionId)] ?? "";
}

export function saveDraft(sessionId: string | null, draft: string): void {
  const key = draftKeyFor(sessionId);
  const map = readMap();
  if (draft.trim() === "") delete map[key];
  else map[key] = draft;
  writeMap(map);
}
