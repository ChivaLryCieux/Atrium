import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, AiProfile, ProviderModel, TokenMetrics } from "../types/chat";
import { AppDialog, AppDialogRequest } from "./AppDialog";
import { default as i18n, normalizeLocale, setAppLocale, type AppLocale } from "../locales";
import { THEMES, normalizeThemeMode, type ThemeMode } from "../themes";
import {
  API_PROTOCOLS,
  deriveEndpoint,
  resolveProfileProtocol,
  splitBaseUrl,
  type ApiProtocol,
} from "../providers/protocols";

type SettingsTab = "general" | "appearance" | "model" | "tokens";

type SettingsViewProps = {
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
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");

  // Local draft state for editing
  const [userName, setUserName] = useState(settings.userName);
  const [activeProfileId, setActiveProfileId] = useState<string>(
    settings.aiProfiles[0]?.id || ""
  );
  const [tokenMetrics, setTokenMetrics] = useState<TokenMetrics | null>(null);
  const [dialog, setDialog] = useState<AppDialogRequest | null>(null);
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const showConfirm = (
    message: string,
    onConfirm: () => void,
    options: { tone?: "default" | "danger"; title?: string; confirmText?: string } = {}
  ) => {
    setDialog({
      kind: "confirm",
      title: options.title ?? tRef.current(options.tone === "danger" ? "common.dangerAction" : "common.confirmAction"),
      message,
      tone: options.tone ?? "danger",
      confirmText: options.confirmText,
      onConfirm,
    });
  };

  const showAlert = (message: string, tone: "default" | "danger" = "default") => {
    setDialog({ kind: "alert", title: tRef.current("common.hint"), message, tone });
  };

  const themeMode = normalizeThemeMode(settings.themeMode);
  const fontSize = settings.fontSize ?? "14px";

  useEffect(() => {
    if (activeTab === "tokens") {
      invoke<TokenMetrics>("get_token_statistics")
        .then((data) => setTokenMetrics(data))
        .catch((err) => console.error(tRef.current("settings.fetchTokensFailed"), err));
    }
  }, [activeTab]);

  const handleResetTokens = async () => {
    try {
      const reset = await invoke<TokenMetrics>("reset_token_statistics");
      setTokenMetrics(reset);
    } catch (err) {
      console.error(tRef.current("settings.resetTokensFailed"), err);
    }
  };

  const currentProfile =
    settings.aiProfiles.find((p) => p.id === activeProfileId) ||
    settings.aiProfiles[0];

  const handleUpdateCurrentProfile = (patch: Partial<AiProfile>) => {
    if (!currentProfile) return;
    const updatedProfiles = settings.aiProfiles.map((p) =>
      p.id === currentProfile.id ? { ...p, ...patch } : p
    );
    onSaveSettings({
      ...settings,
      aiProfiles: updatedProfiles,
    });
  };

  const handleSaveGeneral = () => {
    onSaveSettings({
      ...settings,
      userName: userName.trim() || "Tempsyche",
    });
  };

  const handleAddProvider = async () => {
    try {
      const profile = await invoke<AiProfile>("create_profile");
      const next: AppSettings = {
        ...settings,
        aiProfiles: [...settings.aiProfiles, profile],
      };
      onSaveSettings(next);
      setActiveProfileId(profile.id);
    } catch (err) {
      console.error(t("settings.addProviderFailed"), err);
    }
  };

  const handleDeleteProvider = async () => {
    if (!currentProfile) return;
    const label = currentProfile.name.trim() || t("settings.providerN", { n: profileIndex < 0 ? 1 : profileIndex + 1 });
    showConfirm(t("settings.confirmDeleteProvider", { label }), async () => {
      try {
        const next = await invoke<AppSettings>("delete_profile", {
          profileId: currentProfile.id,
        });
        onSaveSettings(next);
        setActiveProfileId(next.aiProfiles[0]?.id || "");
      } catch (err) {
        console.error(t("settings.deleteProviderFailed"), err);
        showAlert(`${t("settings.deleteProviderFailed")} ${String(err)}`, "danger");
      }
    });
  };

  const handleProbeProvider = async () => {
    if (!currentProfile) return;
    try {
      const message = await invoke<string>("probe_provider", {
        endpoint: currentProfile.endpoint,
        apiKey: currentProfile.apiKey,
        apiProtocol: resolveProfileProtocol(currentProfile.apiProtocol, currentProfile.endpoint),
      });
      showAlert(t("settings.probeOkMessage", { message }));
    } catch (err) {
      showAlert(t("settings.probeFailMessage", { message: String(err) }), "danger");
    }
  };

  const displayName = (profile: AiProfile, index: number) =>
    profile.name.trim() || t("settings.providerN", { n: index + 1 });

  const profileIndex = settings.aiProfiles.findIndex((p) => p.id === currentProfile?.id);

  const updateModels = (models: ProviderModel[]) => {
    handleUpdateCurrentProfile({ models });
  };

  const handleAddModel = () => {
    if (!currentProfile) return;
    updateModels([
      ...currentProfile.models,
      { id: crypto.randomUUID(), name: "", contextLength: null },
    ]);
  };

  const handleUpdateModel = (modelId: string, patch: Partial<ProviderModel>) => {
    if (!currentProfile) return;
    updateModels(currentProfile.models.map((m) => (m.id === modelId ? { ...m, ...patch } : m)));
  };

  const handleRemoveModel = (modelId: string) => {
    if (!currentProfile) return;
    updateModels(currentProfile.models.filter((m) => m.id !== modelId));
  };

  const handleSetDefaultModel = (name: string) => {
    handleUpdateCurrentProfile({ model: name.trim() });
  };

  return (
    <div className="settings-page-layout">
      {/* Left Settings Sidebar */}
      <aside className="settings-sidebar">
        {/* Top: App Logo & Back Button */}
        <div className="settings-sidebar-header">
          <div className="app-logo-badge" title="Atrium">
            <img src="/logo.png" alt="Atrium" className="app-logo-icon" />
          </div>
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
            className={`settings-menu-item ${activeTab === "general" ? "active" : ""}`}
            onClick={() => setActiveTab("general")}
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
            className={`settings-menu-item ${activeTab === "appearance" ? "active" : ""}`}
            onClick={() => setActiveTab("appearance")}
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
            className={`settings-menu-item ${activeTab === "model" ? "active" : ""}`}
            onClick={() => setActiveTab("model")}
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
            className={`settings-menu-item ${activeTab === "tokens" ? "active" : ""}`}
            onClick={() => setActiveTab("tokens")}
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
        </nav>
      </aside>

      {/* Right Settings Content Canvas */}
      <main className="settings-main-content">
        {/* ========================================================= */}
        {/* TAB 1: 常规设置                                           */}
        {/* ========================================================= */}
        {activeTab === "general" && (
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
                    onBlur={handleSaveGeneral}
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
        )}

        {/* ========================================================= */}
        {/* TAB 2: 外观设置                                           */}
        {/* ========================================================= */}
        {activeTab === "appearance" && (
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
        )}

        {/* ========================================================= */}
        {/* TAB 3: 模型设置（全部为自定义供应商）                      */}
        {/* ========================================================= */}
        {activeTab === "model" && (
          <div className="settings-tab-pane">
            <div className="pane-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 className="pane-title">{t("settings.modelTitle")}</h2>
                <p className="pane-subtitle">{t("settings.modelSubtitle")}</p>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" className="zcode-btn-primary" onClick={handleAddProvider}>
                  {t("settings.addProviderBtn")}
                </button>
              </div>
            </div>

            <div className="model-split-view">
              {/* Left Column: Providers List */}
              <div className="providers-column">
                <div className="column-subheading">{t("settings.providers")}</div>
                {settings.aiProfiles.map((profile, index) => {
                  const ready = profile.apiKey.trim() !== "" && profile.endpoint.trim() !== "";
                  return (
                    <div
                      key={profile.id}
                      className={`provider-list-item ${currentProfile?.id === profile.id ? "active" : ""}`}
                      onClick={() => setActiveProfileId(profile.id)}
                    >
                      <span className="provider-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        </svg>
                      </span>
                      <span className="provider-text">
                        <span className="provider-name">{displayName(profile, index)}</span>
                        {profile.description.trim() && (
                          <span className="provider-desc">{profile.description}</span>
                        )}
                      </span>
                      <span
                        className={`status-dot ${ready ? "success" : "warning"}`}
                        title={ready ? t("settings.readyHint") : t("settings.unconfiguredHint")}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Right Column: Provider Detail Card */}
              <div className="provider-detail-column">
                {currentProfile ? (
                  <div className="provider-detail-card">
                    {/* Identity */}
                    <div className="detail-card-header">
                      <span className="provider-badge-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        </svg>
                      </span>
                      <h3>{displayName(currentProfile, profileIndex < 0 ? 0 : profileIndex)}</h3>
                    </div>

                    {/* Connection Config Form */}
                    <div className="config-form-section">
                      <div className="form-item">
                        <label>{t("settings.providerNameOptional")}</label>
                        <input
                          type="text"
                          className="zcode-input"
                          value={currentProfile.name}
                          onChange={(e) => handleUpdateCurrentProfile({ name: e.target.value })}
                          placeholder={t("settings.providerN", { n: profileIndex < 0 ? 1 : profileIndex + 1 })}
                        />
                      </div>

                      <div className="form-item">
                        <label>{t("settings.providerDescOptional")}</label>
                        <input
                          type="text"
                          className="zcode-input"
                          value={currentProfile.description}
                          onChange={(e) => handleUpdateCurrentProfile({ description: e.target.value })}
                          placeholder={t("settings.providerDescPlaceholder")}
                        />
                      </div>

                      {/* API protocol — drives endpoint path and wire format */}
                      <div className="form-item">
                        <label>{t("settings.apiProtocol")}</label>
                        <select
                          className="zcode-select"
                          value={resolveProfileProtocol(currentProfile.apiProtocol, currentProfile.endpoint)}
                          onChange={(e) => {
                            const protocol = e.target.value as ApiProtocol;
                            handleUpdateCurrentProfile({
                              apiProtocol: protocol,
                              endpoint: deriveEndpoint(splitBaseUrl(currentProfile.endpoint), protocol),
                            });
                          }}
                        >
                          {API_PROTOCOLS.map((protocol) => (
                            <option key={protocol.id} value={protocol.id}>
                              {t(protocol.nameKey)}
                            </option>
                          ))}
                        </select>
                        <span className="form-hint">{t("settings.apiProtocolDesc")}</span>
                      </div>

                      {/* Base URL — the endpoint with any protocol suffix stripped */}
                      <div className="form-item">
                        <label>Base URL</label>
                        <input
                          type="text"
                          className="zcode-input"
                          value={splitBaseUrl(currentProfile.endpoint)}
                          onChange={(e) =>
                            handleUpdateCurrentProfile({
                              endpoint: deriveEndpoint(
                                e.target.value,
                                resolveProfileProtocol(currentProfile.apiProtocol, currentProfile.endpoint),
                              ),
                            })
                          }
                          placeholder="https://api.deepseek.com/v1"
                        />
                      </div>

                      {/* Inference endpoint — auto-completed, still editable */}
                      <div className="form-item">
                        <label>{t("settings.inferenceEndpoint")}</label>
                        <input
                          type="text"
                          className="zcode-input"
                          value={currentProfile.endpoint}
                          onChange={(e) => handleUpdateCurrentProfile({ endpoint: e.target.value })}
                          placeholder="https://api.deepseek.com/v1/chat/completions"
                        />
                        <span className="form-hint">{t("settings.endpointAutoHint")}</span>
                      </div>

                      <div className="form-item">
                        <label>API Key</label>
                        <input
                          type="password"
                          className="zcode-input"
                          value={currentProfile.apiKey}
                          onChange={(e) => handleUpdateCurrentProfile({ apiKey: e.target.value })}
                          placeholder="sk-..."
                        />
                      </div>
                    </div>

                    {/* Models List Section */}
                    <div className="models-list-section">
                      <div className="models-list-header">
                        <span>{t("settings.modelList")}</span>
                        <button type="button" className="zcode-btn-secondary small" onClick={handleAddModel}>
                          {t("settings.addModelBtn")}
                        </button>
                      </div>

                      <div className="models-table">
                        {currentProfile.models.length > 0 ? (
                          currentProfile.models.map((model) => (
                            <div key={model.id} className="model-edit-row">
                              <input
                                type="text"
                                className="zcode-input"
                                value={model.name}
                                onChange={(e) => handleUpdateModel(model.id, { name: e.target.value })}
                                placeholder={t("settings.modelNamePlaceholder")}
                              />
                              <input
                                type="text"
                                className="zcode-input"
                                value={model.contextLength ?? ""}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/[^0-9]/g, "");
                                  handleUpdateModel(model.id, { contextLength: raw === "" ? null : Number(raw) });
                                }}
                                placeholder={t("settings.contextLengthPlaceholder")}
                              />
                              <button
                                type="button"
                                className={`zcode-btn-secondary small ${currentProfile.model === model.name.trim() && model.name.trim() ? "active" : ""}`}
                                disabled={!model.name.trim()}
                                onClick={() => handleSetDefaultModel(model.name)}
                                title={t("settings.setDefaultModelHint")}
                              >
                                {model.name.trim() !== "" && currentProfile.model === model.name.trim() ? t("common.default") : t("common.setAsDefault")}
                              </button>
                              <button
                                type="button"
                                className="model-row-remove"
                                onClick={() => handleRemoveModel(model.id)}
                                title={t("settings.deleteModel")}
                              >
                                ✕
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="model-row-item" style={{ color: "var(--text-muted)", justifyContent: "center", padding: "14px" }}>
                            {t("settings.noModelsHint")}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="detail-actions">
                      <button
                        type="button"
                        className="zcode-btn-dark-pill"
                        onClick={handleProbeProvider}
                        title={t("settings.probeHint")}
                      >
                        {t("settings.probeBtn")}
                      </button>
                      <button
                        type="button"
                        className="zcode-btn-danger"
                        onClick={handleDeleteProvider}
                        title={t("settings.deleteProviderHint")}
                      >
                        {t("settings.deleteProviderBtn")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="provider-detail-card" style={{ color: "var(--text-muted)" }}>
                    {t("settings.noProviders")}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: 词元统计                                           */}
        {/* ========================================================= */}
        {activeTab === "tokens" && (
          <div className="settings-tab-pane">
            <div className="pane-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 className="pane-title">{t("settings.tokenStatsTitle")}</h2>
                <p className="pane-subtitle">{t("settings.tokenStatsSubtitle")}</p>
              </div>
              <button
                type="button"
                className="zcode-btn-secondary small"
                onClick={handleResetTokens}
                title={t("settings.resetStatsHint")}
              >
                {t("settings.resetStatsBtn")}
              </button>
            </div>

            {/* Metric Overview Cards */}
            <div className="stats-metric-grid">
              <div className="metric-card">
                <span className="metric-label">{t("settings.inputTokens")}</span>
                <span className="metric-value">
                  {tokenMetrics ? tokenMetrics.totalPromptTokens.toLocaleString() : "0"}
                </span>
                <span className="metric-trend text-success">{t("settings.inputTokensHint")}</span>
              </div>

              <div className="metric-card">
                <span className="metric-label">{t("settings.outputTokens")}</span>
                <span className="metric-value">
                  {tokenMetrics ? tokenMetrics.totalCompletionTokens.toLocaleString() : "0"}
                </span>
                <span className="metric-trend text-success">{t("settings.outputTokensHint")}</span>
              </div>

              <div className="metric-card">
                <span className="metric-label">{t("settings.totalRequests")}</span>
                <span className="metric-value">
                  {tokenMetrics ? t("common.timesCount", { count: tokenMetrics.totalRequests }) : t("common.timesCount", { count: 0 })}
                </span>
                <span className="metric-trend">{t("settings.totalRequestsHint")}</span>
              </div>

              <div className="metric-card">
                <span className="metric-label">{t("settings.avgLatency")}</span>
                <span className="metric-value">
                  {tokenMetrics && tokenMetrics.totalRequests > 0
                    ? `${Math.round(tokenMetrics.totalLatencyMs / tokenMetrics.totalRequests)} ms`
                    : "0 ms"}
                </span>
                <span className="metric-trend">{t("settings.avgLatencyHint")}</span>
              </div>
            </div>

            {/* Token Usage Breakdown Table */}
            <div className="settings-card" style={{ marginTop: "20px" }}>
              <div className="list-section-header" style={{ marginBottom: "8px" }}>
                {t("settings.modelBreakdown")}
              </div>
              <div className="models-table">
                <div className="model-row-item header">
                  <span>{t("settings.colModel")}</span>
                  <span>{t("settings.colInput")}</span>
                  <span>{t("settings.colOutput")}</span>
                  <span>{t("settings.colCalls")}</span>
                  <span>{t("settings.colLatency")}</span>
                  <span>{t("settings.colStatus")}</span>
                </div>
                {tokenMetrics && tokenMetrics.models.length > 0 ? (
                  tokenMetrics.models.map((m) => (
                    <div key={m.modelName} className="model-row-item">
                      <span className="model-title">{m.modelName}</span>
                      <span>{m.promptTokens.toLocaleString()}</span>
                      <span>{m.completionTokens.toLocaleString()}</span>
                      <span>{t("common.timesCount", { count: m.requestCount })}</span>
                      <span>
                        {m.requestCount > 0
                          ? `${Math.round(m.totalLatencyMs / m.requestCount)} ms`
                          : "-"}
                      </span>
                      <span className="status-badge active">{t("settings.ready")}</span>
                    </div>
                  ))
                ) : (
                  <div className="model-row-item" style={{ color: "var(--zcode-text-tertiary)", justifyContent: "center", padding: "16px" }}>
                    {t("settings.noRecords")}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* In-app centered dialog (replaces native confirm/alert) */}
      {dialog && <AppDialog request={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
