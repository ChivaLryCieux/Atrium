/**
 * Atrium theme registry — the single source of truth for named themes.
 *
 * Storage: `AppSettings.themeMode` holds a ThemeMode string (persisted by the
 * Rust host as an opaque string; legacy values `light` / `dark` are migrated
 * by `normalizeThemeMode`). Switching writes two attributes on <html>:
 *
 *   data-theme           resolved ThemeId — drives every theme block in CSS
 *   data-resolved-theme  light | dark appearance signal (derived)
 *
 * To add a theme: append a ThemeDefinition here, add its i18n keys, and add a
 * `[data-theme="<id>"]` variable block in styles.css. Nothing else changes.
 */

export type ThemeId = "pure-white" | "pure-black" | "atrium-color";
export type ThemeMode = ThemeId | "system";
export type ThemeAppearance = "light" | "dark";

export interface ThemeDefinition {
  id: ThemeId;
  appearance: ThemeAppearance;
  /// i18n key for the display name in settings.
  nameKey: string;
  /// i18n key for the one-line description (settings tooltip).
  descriptionKey: string;
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "pure-white",
    appearance: "light",
    nameKey: "settings.themePureWhite",
    descriptionKey: "settings.themePureWhiteDesc",
  },
  {
    id: "pure-black",
    appearance: "dark",
    nameKey: "settings.themePureBlack",
    descriptionKey: "settings.themePureBlackDesc",
  },
  {
    id: "atrium-color",
    appearance: "light",
    nameKey: "settings.themeAtriumColor",
    descriptionKey: "settings.themeAtriumColorDesc",
  },
];

export const DEFAULT_THEME_MODE: ThemeMode = "pure-white";

/// Legacy theme values from before the named-theme system.
const LEGACY_THEME_MODES: Record<string, ThemeMode> = {
  light: "pure-white",
  dark: "pure-black",
  system: "system",
};

const THEME_IDS: readonly string[] = THEMES.map((theme) => theme.id);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.includes(value);
}

/// Accept any stored value (including legacy `light`/`dark`, null, garbage)
/// and return a valid ThemeMode. Unknown values fall back to the default.
export function normalizeThemeMode(value: unknown): ThemeMode {
  if (typeof value !== "string") return DEFAULT_THEME_MODE;
  const trimmed = value.trim();
  if (trimmed === "system") return "system";
  const legacy = LEGACY_THEME_MODES[trimmed];
  if (legacy) return legacy;
  return isThemeId(trimmed) ? trimmed : DEFAULT_THEME_MODE;
}

/// Resolve a mode to a concrete theme. `system` follows the OS preference:
/// dark picks pure-black, everything else picks pure-white.
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ThemeId {
  if (mode !== "system") return mode;
  return prefersDark ? "pure-black" : "pure-white";
}

export function themeAppearance(theme: ThemeId): ThemeAppearance {
  return THEMES.find((entry) => entry.id === theme)?.appearance ?? "light";
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/// Apply a mode to the document and return the resolved theme id.
export function applyTheme(mode: ThemeMode): ThemeId {
  const theme = resolveTheme(mode, systemPrefersDark());
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.resolvedTheme = themeAppearance(theme);
  }
  return theme;
}
