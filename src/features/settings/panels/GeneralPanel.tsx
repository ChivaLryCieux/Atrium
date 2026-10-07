import React from "react";
import { useTranslation } from "react-i18next";
import { AppSettings } from "../../../types/chat";
import { default as i18n, normalizeLocale, setAppLocale, type AppLocale } from "../../../locales";

interface GeneralPanelProps {
  userName: string;
  setUserName: (v: string) => void;
  onSaveGeneral: () => void;
  workspacePath: string;
  onOpenWorkspace: () => void;
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => void;
  onClearHistory: () => void;
  showConfirm: (message: string, onConfirm: () => void) => void;
}

export const GeneralPanel: React.FC<GeneralPanelProps> = ({
  userName,
  setUserName,
  onSaveGeneral,
  workspacePath,
  onOpenWorkspace,
  settings,
  onSaveSettings,
  onClearHistory,
  showConfirm,
}) => {
  const { t } = useTranslation();

  return (
    <div className="settings-tab-pane">
      <div className="pane-header">
        <h2 className="pane-title">{t("settings.generalTitle")}</h2>
        <p className="pane-subtitle">{t("settings.generalSubtitle")}</p>
      </div>

      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-label-col">
            <span className="setting-title">{t("settings.userNameTitle")}</span>
            <span className="setting-desc">{t("settings.userNameDesc")}</span>
          </div>
          <div className="setting-control-col">
            <input
              type="text"
              className="zcode-input"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              onBlur={onSaveGeneral}
              placeholder={t("settings.userNamePlaceholder")}
            />
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-label-col">
            <span className="setting-title">{t("settings.workspaceTitle")}</span>
            <span className="setting-desc">{t("settings.workspaceDesc")}</span>
          </div>
          <div className="setting-control-col" style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              className="zcode-input"
              readOnly
              value={workspacePath || t("settings.noWorkspace")}
            />
            <button type="button" className="zcode-btn-secondary" onClick={onOpenWorkspace}>
              {t("settings.openWorkspaceDir")}
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-label-col">
            <span className="setting-title">{t("settings.orchestrationTitle")}</span>
            <span className="setting-desc">{t("settings.orchestrationDesc")}</span>
          </div>
          <div className="setting-control-col">
            <select
              className="zcode-select"
              value={settings.orchestrationMode}
              onChange={(e) =>
                onSaveSettings({
                  ...settings,
                  orchestrationMode: e.target.value as AppSettings["orchestrationMode"],
                })
              }
            >
              <option value="single">{t("settings.orchestrationSingle")}</option>
              <option value="dag">{t("settings.orchestrationDag")}</option>
              <option value="parallel">{t("settings.orchestrationParallel")}</option>
            </select>
          </div>
        </div>

        <div className="setting-row danger-zone">
          <div className="setting-label-col">
            <span className="setting-title" style={{ color: "var(--accent-danger)" }}>
              {t("settings.resetHistoryTitle")}
            </span>
            <span className="setting-desc">{t("settings.resetHistoryDesc")}</span>
          </div>
          <div className="setting-control-col">
            <button
              type="button"
              className="zcode-btn-danger"
              onClick={() =>
                showConfirm(t("settings.confirmClearAll"), () => onClearHistory())
              }
            >
              {t("settings.clearHistoryBtn")}
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-label-col">
            <span className="setting-title">{t("settings.languageTitle")}</span>
            <span className="setting-desc">{t("settings.languageDesc")}</span>
          </div>
          <div className="setting-control-col">
            <select
              className="zcode-select"
              value={normalizeLocale(i18n.resolvedLanguage ?? i18n.language)}
              onChange={(e) => setAppLocale(e.target.value as AppLocale)}
            >
              <option value="zh-CN">{t("language.zhCN")}</option>
              <option value="en">{t("language.en")}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
