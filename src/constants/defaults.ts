import i18n from "../locales";
import { ChatMessage } from "../types/chat";

export const createUserMessage = (content: string, userName: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  content,
  speakerName: userName || i18n.t("app.me"),
  avatar: i18n.t("app.me"),
});
