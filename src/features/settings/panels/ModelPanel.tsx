import React from "react";
import { useTranslation } from "react-i18next";
import { AiProfile, AppSettings, ProviderModel } from "../../../types/chat";
import {
  API_PROTOCOLS,
  deriveEndpoint,
  resolveProfileProtocol,
  splitBaseUrl,
  type ApiProtocol,
} from "../../../providers/protocols";

interface ModelPanelProps {
  settings: AppSettings;
  currentProfile?: AiProfile;
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  profileIndex: number;
  baseUrlInput: string;
  setBaseUrlInput: (v: string) => void;
  onAddProvider: () => void;
  onDeleteProvider: () => void;
  onProbeProvider: () => void;
  onUpdateCurrentProfile: (patch: Partial<AiProfile>) => void;
  onAddModel: () => void;
  onUpdateModel: (modelId: string, patch: Partial<ProviderModel>) => void;
  onRemoveModel: (modelId: string) => void;
}

export const ModelPanel: React.FC<ModelPanelProps> = ({
  settings,
  currentProfile,
  setActiveProfileId,
  profileIndex,
  baseUrlInput,
  setBaseUrlInput,
  onAddProvider,
  onDeleteProvider,
  onProbeProvider,
  onUpdateCurrentProfile,
  onAddModel,
  onUpdateModel,
  onRemoveModel,
}) => {
  const { t } = useTranslation();

  const displayName = (profile: AiProfile, index: number) =>
    profile.name.trim() || t("settings.providerN", { n: index + 1 });

  return (
    <div className="settings-tab-pane">
      <div className="pane-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 className="pane-title">{t("settings.modelTitle")}</h2>
          <p className="pane-subtitle">{t("settings.modelSubtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className="zcode-btn-primary" onClick={onAddProvider}>
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
              <div className="detail-card-header">
                <span className="provider-badge-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                </span>
                <h3>{displayName(currentProfile, profileIndex < 0 ? 0 : profileIndex)}</h3>
              </div>

              <div className="config-form-section">
                <div className="form-item">
                  <label>{t("settings.providerNameOptional")}</label>
                  <input
                    type="text"
                    className="zcode-input"
                    value={currentProfile.name}
                    onChange={(e) => onUpdateCurrentProfile({ name: e.target.value })}
                    placeholder={t("settings.providerN", { n: profileIndex < 0 ? 1 : profileIndex + 1 })}
                  />
                </div>

                <div className="form-item">
                  <label>{t("settings.providerDescOptional")}</label>
                  <input
                    type="text"
                    className="zcode-input"
                    value={currentProfile.description}
                    onChange={(e) => onUpdateCurrentProfile({ description: e.target.value })}
                    placeholder={t("settings.providerDescPlaceholder")}
                  />
                </div>

                <div className="form-item">
                  <label>{t("settings.apiProtocol")}</label>
                  <select
                    className="zcode-select"
                    value={resolveProfileProtocol(currentProfile.apiProtocol, currentProfile.endpoint)}
                    onChange={(e) => {
                      const protocol = e.target.value as ApiProtocol;
                      const base = baseUrlInput.trim() || splitBaseUrl(currentProfile.endpoint);
                      onUpdateCurrentProfile({
                        apiProtocol: protocol,
                        endpoint: deriveEndpoint(base, protocol),
                      });
                    }}
                  >
                    {API_PROTOCOLS.map((protocol) => (
                      <option key={protocol.id} value={protocol.id}>
                        {t(protocol.nameKey)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-item">
                  <label>Base URL</label>
                  <input
                    type="text"
                    className="zcode-input"
                    value={baseUrlInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBaseUrlInput(val);
                      const protocol = resolveProfileProtocol(currentProfile.apiProtocol, currentProfile.endpoint);
                      onUpdateCurrentProfile({
                        endpoint: deriveEndpoint(val, protocol),
                      });
                    }}
                    onBlur={() => {
                      if (currentProfile?.endpoint) {
                        setBaseUrlInput(splitBaseUrl(currentProfile.endpoint));
                      }
                    }}
                    placeholder="https://api.deepseek.com/v1"
                  />
                </div>

                <div className="form-item">
                  <label>API Key</label>
                  <input
                    type="password"
                    className="zcode-input"
                    value={currentProfile.apiKey}
                    onChange={(e) => onUpdateCurrentProfile({ apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </div>
              </div>

              <div className="models-list-section">
                <div className="models-list-header">
                  <span>{t("settings.modelList")}</span>
                  <button type="button" className="zcode-btn-secondary small" onClick={onAddModel}>
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
                          onChange={(e) => onUpdateModel(model.id, { name: e.target.value })}
                          placeholder={t("settings.modelNamePlaceholder")}
                        />
                        <select
                          className="zcode-select"
                          value={model.contextLength && Number(model.contextLength) >= 500000 ? 1000000 : 256000}
                          onChange={(e) => {
                            onUpdateModel(model.id, { contextLength: Number(e.target.value) });
                          }}
                        >
                          <option value={256000}>{t("settings.contextLength256k")}</option>
                          <option value={1000000}>{t("settings.contextLength1m")}</option>
                        </select>
                        <button
                          type="button"
                          className="model-row-remove"
                          onClick={() => onRemoveModel(model.id)}
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

              <div className="detail-actions">
                <button
                  type="button"
                  className="zcode-btn-dark-pill"
                  onClick={onProbeProvider}
                  title={t("settings.probeHint")}
                >
                  {t("settings.probeBtn")}
                </button>
                <button
                  type="button"
                  className="zcode-btn-danger"
                  onClick={onDeleteProvider}
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
  );
};
