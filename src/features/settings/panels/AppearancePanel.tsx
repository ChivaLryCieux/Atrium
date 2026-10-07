import React from "react";
import { useTranslation } from "react-i18next";
import { AppSettings } from "../../../types/chat";
import { THEMES, normalizeThemeMode, type ThemeMode } from "../../../themes";

interface AppearancePanelProps {
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => void;
}

export const AppearancePanel: React.FC<AppearancePanelProps> = ({
  settings,
  onSaveSettings,
}) => {
  const { t } = useTranslation();
  const themeMode = normalizeThemeMode(settings.themeMode);
  const fontSize = settings.fontSize ?? "14px";

  return (
    <div className="settings-tab-pane">
      <div className="pane-header">
        <h2 className="pane-title">{t("settings.appearanceTitle")}</h2>
        <p className="pane-subtitle">{t("settings.appearanceSubtitle")}</p>
      </div>

      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-label-col">
            <span className="setting-title">{t("settings.themeTitle")}</span>
            <span className="setting-desc">{t("settings.themeDesc")}</span>
          </div>
          <div className="setting-control-col">
            <div className="theme-toggle-group">
              {([...THEMES.map((entry) => entry.id), "system"] as ThemeMode[]).map((mode) => {
                const theme = THEMES.find((entry) => entry.id === mode);
                return (
                  <button
                    key={mode}
                    type="button"
                    title={theme ? t(theme.descriptionKey) : t("settings.themeSystemDesc")}
                    className={`theme-option-btn ${themeMode === mode ? "active" : ""}`}
                    onClick={() => onSaveSettings({ ...settings, themeMode: mode })}
                  >
                    <span>{theme ? t(theme.nameKey) : t("settings.themeSystem")}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-label-col">
            <span className="setting-title">{t("settings.fontSizeTitle")}</span>
            <span className="setting-desc">{t("settings.fontSizeDesc")}</span>
          </div>
          <div className="setting-control-col">
            <select
              className="zcode-select"
              value={fontSize}
              onChange={(e) =>
                onSaveSettings({ ...settings, fontSize: e.target.value as AppSettings["fontSize"] })
              }
            >
              <option value="13px">{t("settings.fontSizeCompact")}</option>
              <option value="14px">{t("settings.fontSizeStandard")}</option>
              <option value="15px">{t("settings.fontSizeComfortable")}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
