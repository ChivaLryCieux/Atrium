import i18n from "../locales";
import { AiProfile, ChatMessage, PendingMessage } from "../types/chat";

export function createPendingMessages(profiles: AiProfile[]): PendingMessage[] {
  return profiles.map((profile) => ({
    id: crypto.randomUUID(),
    role: "assistant",
    content: i18n.t("app.thinking"),
    speakerId: profile.id,
    speakerName: profile.name,
    avatar: profile.avatar,
    pending: true,
  }));
}

/**
 * Deduplicate and sanitize message IDs so legacy session files or
 * static stage identifiers never cause key or virtualizer height collisions.
 */
export function ensureUniqueMessageIds(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return messages.map((m, idx) => {
    let id = m.id;
    if (!id || seen.has(id)) {
      id = `${id || "msg"}-${idx}-${Date.now()}`;
    }
    seen.add(id);
    return id === m.id ? m : { ...m, id };
  });
}
