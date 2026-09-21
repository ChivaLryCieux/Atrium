import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import zhCN from "./zh-CN/translation.json";
import en from "./en/translation.json";

export type AppLocale = "zh-CN" | "en";

export const SUPPORTED_LOCALES: AppLocale[] = ["zh-CN", "en"];

/// localStorage key holding the operator's explicit choice. The detector
/// reads it first, so a manual switch survives restarts and beats the OS
/// locale on every later launch.
export const LOCALE_STORAGE_KEY = "atrium.locale";

export function normalizeLocale(value: string | undefined | null): AppLocale {
  const raw = (value ?? "").toLowerCase();
  if (raw.startsWith("en")) return "en";
  return "zh-CN";
}

if (!i18n.isInitialized) {
  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        "zh-CN": { translation: zhCN },
        en: { translation: en },
      },
      supportedLngs: SUPPORTED_LOCALES,
      fallbackLng: "zh-CN",
      // nonExplicitSupportedLngs must stay off: supportedLngs holds the
      // regional code "zh-CN", and the flag strips codes to their language
      // part ("zh-CN" -> "zh") before matching — every code, fallback
      // included, is then rejected, the resolve hierarchy comes back empty
      // and t() returns raw keys. load: "currentOnly" keeps the hierarchy
      // exact to the shipped resource keys.
      load: "currentOnly",
      detection: {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: LOCALE_STORAGE_KEY,
        caches: ["localStorage"],
      },
      interpolation: { escapeValue: false },
      returnEmptyString: false,
    });
}

export function setAppLocale(locale: AppLocale): void {
  void i18n.changeLanguage(locale);
}

export default i18n;

