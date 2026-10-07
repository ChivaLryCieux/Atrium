import { useTranslation } from "react-i18next";
import { AppSettings } from "../../types/chat";
import { AppDialog } from "../../components/AppDialog";
import { useSettingsForm } from "./useSettingsForm";
import { GeneralPanel } from "./panels/GeneralPanel";
import { AppearancePanel } from "./panels/AppearancePanel";
import { ModelPanel } from "./panels/ModelPanel";
import { TokensPanel } from "./panels/TokensPanel";
import { ShortcutsPanel } from "./panels/ShortcutsPanel";

export type SettingsViewProps = {
  onBack: () => void;
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => void;
  onClearHistory: () => void;
  workspacePath: string;
  onOpenWorkspace: () => void;
};

export function SettingsView({
  onBack,
  settings,
  onSaveSettings,
  onClearHistory,
  workspacePath,
  onOpenWorkspace,
}: SettingsViewProps) {
  const { t } = useTranslation();

  const form = useSettingsForm({
    settings,
    onSaveSettings,
  });

  return (
    <div className="settings-page-layout">
      {/* Left Settings Sidebar */}
      <aside className="settings-sidebar">
        {/* Top: Back Button */}
        <div className="settings-sidebar-header">
          <button type="button" className="settings-back-btn" onClick={onBack} title={t("settings.backToWorkspace")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span>{t("settings.backToWorkspace")}</span>
          </button>
        </div>

        {/* Section Header */}
        <div className="settings-menu-group-title">{t("settings.baseGroup")}</div>

        {/* Nav Items */}
        <nav className="settings-menu-list">
          {/* 1. 常规 */}
          <button
            type="button"
            className={`settings-menu-item ${form.activeTab === "general" ? "active" : ""}`}
            onClick={() => form.setActiveTab("general")}
          >
            <span className="menu-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </span>
            <span>{t("settings.general")}</span>
          </button>

          {/* 2. 外观 */}
          <button
            type="button"
            className={`settings-menu-item ${form.activeTab === "appearance" ? "active" : ""}`}
            onClick={() => form.setActiveTab("appearance")}
          >
            <span className="menu-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </span>
            <span>{t("settings.appearance")}</span>
          </button>

          {/* 3. 模型 */}
          <button
            type="button"
            className={`settings-menu-item ${form.activeTab === "model" ? "active" : ""}`}
            onClick={() => form.setActiveTab("model")}
          >
            <span className="menu-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </span>
            <span>{t("settings.modelTab")}</span>
          </button>

          {/* 4. 词元统计 */}
          <button
            type="button"
            className={`settings-menu-item ${form.activeTab === "tokens" ? "active" : ""}`}
            onClick={() => form.setActiveTab("tokens")}
          >
            <span className="menu-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </span>
            <span>{t("settings.tokenStats")}</span>
          </button>

          {/* 5. 快捷键 */}
          <button
            type="button"
            className={`settings-menu-item ${form.activeTab === "shortcuts" ? "active" : ""}`}
            onClick={() => form.setActiveTab("shortcuts")}
          >
            <span className="menu-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" strokeLinecap="round" />
              </svg>
            </span>
            <span>{t("settings.shortcutsTab")}</span>
          </button>
        </nav>
      </aside>

      {/* Right Settings Content Canvas */}
      <main className="settings-main-content">
        {form.activeTab === "general" && (
          <GeneralPanel
            userName={form.userName}
            setUserName={form.setUserName}
            onSaveGeneral={form.handleSaveGeneral}
            workspacePath={workspacePath}
            onOpenWorkspace={onOpenWorkspace}
            settings={settings}
            onSaveSettings={onSaveSettings}
            onClearHistory={onClearHistory}
            showConfirm={form.showConfirm}
          />
        )}
        {form.activeTab === "appearance" && (
          <AppearancePanel settings={settings} onSaveSettings={onSaveSettings} />
        )}
        {form.activeTab === "model" && (
          <ModelPanel
            settings={settings}
            currentProfile={form.currentProfile}
            activeProfileId={form.activeProfileId}
            setActiveProfileId={form.setActiveProfileId}
            profileIndex={form.profileIndex}
            baseUrlInput={form.baseUrlInput}
            setBaseUrlInput={form.setBaseUrlInput}
            onAddProvider={form.handleAddProvider}
            onDeleteProvider={form.handleDeleteProvider}
            onProbeProvider={form.handleProbeProvider}
            onUpdateCurrentProfile={form.handleUpdateCurrentProfile}
            onAddModel={form.handleAddModel}
            onUpdateModel={form.handleUpdateModel}
            onRemoveModel={form.handleRemoveModel}
          />
        )}
        {form.activeTab === "tokens" && (
          <TokensPanel
            tokenMetrics={form.tokenMetrics}
            onResetTokens={form.handleResetTokens}
          />
        )}
        {form.activeTab === "shortcuts" && <ShortcutsPanel />}
      </main>

      {/* In-app centered dialog (replaces native confirm/alert) */}
      {form.dialog && <AppDialog request={form.dialog} onClose={() => form.setDialog(null)} />}
    </div>
  );
}
