import i18n from "../locales";
import { AiProfile, PendingMessage } from "../types/chat";

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
