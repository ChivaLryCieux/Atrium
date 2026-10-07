import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchPluginCatalog,
  toggleBundle,
  installPlugin,
  removePlugin,
  inspectPlugin,
  PluginBundle,
  PluginCatalog,
} from "../services/pluginApi";
import { dshClient } from "../services/dshClient";
import { AppDialog, AppDialogRequest } from "./AppDialog";

interface PluginManagerDialogProps {
  onClose: () => void;
}

export function PluginManagerDialog({ onClose }: PluginManagerDialogProps) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"installed" | "featured" | "install">("installed");
  const [searchQuery, setSearchQuery] = useState("");
  const [operatingMap, setOperatingMap] = useState<Record<string, boolean>>({});

  // Install Tab state
  const [installSpec, setInstallSpec] = useState("");
  const [selectedRegistry, setSelectedRegistry] = useState("https://registry.npmjs.org/");
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectedInfo, setInspectedInfo] = useState<any | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const terminalRef = useRef<HTMLDivElement | null>(null);

  // Dialog / Toast state
  const [dialog, setDialog] = useState<AppDialogRequest | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await fetchPluginCatalog("sdk");
      setCatalog(data);
    } catch (err: any) {
      setError(err?.message || t("plugins.loadFailed"));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Listen to WS logs and status changes if DshClient connects
    dshClient.ensureConnected();

    const handleLog = (event: any) => {
      if (event?.type === "plugin-install-log" && event.chunk) {
        setInstallLogs((prev) => [...prev, event.chunk]);
      } else if (event?.type === "plugin-status") {
        loadData(true);
      }
    };

    const cleanup = dshClient.onTelemetry(handleLog);
    return () => {
      cleanup();
    };
  }, []);

  // Auto scroll terminal log
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [installLogs]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggle = async (bundle: PluginBundle) => {
    if (bundle.core) {
      setDialog({
        kind: "alert",
        title: t("common.hint"),
        message: t("plugins.coreNotice"),
        tone: "default",
      });
      return;
    }

    const nextState = !bundle.enabled;
    setOperatingMap((prev) => ({ ...prev, [bundle.name]: true }));
    try {
      await toggleBundle(bundle.name, nextState, catalog?.profile || "sdk");
      showToast(`${bundle.name} ${nextState ? t("plugins.statusEnabled") : t("plugins.statusDisabled")}`);
      await loadData(true);
    } catch (err: any) {
      setDialog({
        kind: "alert",
        title: t("common.hint"),
        message: err.message || "Failed to toggle bundle",
        tone: "danger",
      });
    } finally {
      setOperatingMap((prev) => ({ ...prev, [bundle.name]: false }));
    }
  };

  const handleUninstall = (bundle: PluginBundle) => {
    setDialog({
      kind: "confirm",
      title: t("common.dangerAction"),
      message: t("plugins.confirmUninstall", { name: bundle.title || bundle.name }),
      tone: "danger",
      onConfirm: async () => {
        setOperatingMap((prev) => ({ ...prev, [bundle.name]: true }));
        try {
          await removePlugin(bundle.name, catalog?.profile || "sdk");
          showToast(`${bundle.name} ${t("plugins.uninstall")}`);
          await loadData(true);
        } catch (err: any) {
          setDialog({
            kind: "alert",
            title: t("common.hint"),
            message: err.message || "Failed to remove plugin",
            tone: "danger",
          });
        } finally {
          setOperatingMap((prev) => ({ ...prev, [bundle.name]: false }));
        }
      },
    });
  };

  const handleInspect = async () => {
    const spec = installSpec.trim();
    if (!spec) return;
    setIsInspecting(true);
    setInspectedInfo(null);
    try {
      const info = await inspectPlugin(spec, selectedRegistry);
      setInspectedInfo(info);
      showToast(t("plugins.inspectSuccess"));
    } catch (err: any) {
      setDialog({
        kind: "alert",
        title: t("common.hint"),
        message: err.message || "Inspect failed",
        tone: "danger",
      });
    } finally {
      setIsInspecting(false);
    }
  };

  const handleInstall = async () => {
    const spec = installSpec.trim();
    if (!spec) return;
    setIsInstalling(true);
    setInstallLogs([`>> 准备安装: ${spec}\n`]);
    try {
      await installPlugin(spec, selectedRegistry, catalog?.profile || "sdk");
      showToast(t("plugins.installSuccess", { name: spec }));
      setInstallSpec("");
      setInspectedInfo(null);
      await loadData(true);
    } catch (err: any) {
      setDialog({
        kind: "alert",
        title: t("plugins.installFailed"),
        message: err.message || String(err),
        tone: "danger",
      });
    } finally {
      setIsInstalling(false);
    }
  };

  const bundles = catalog?.bundles || [];
  const query = searchQuery.trim().toLowerCase();

  const filterBundles = (list: PluginBundle[]) =>
    list.filter(
      (b) =>
        !query ||
        b.name.toLowerCase().includes(query) ||
        (b.title && b.title.toLowerCase().includes(query)) ||
        (b.description && b.description.toLowerCase().includes(query))
    );

  const installedList = filterBundles(bundles.filter((b) => b.installed || b.enabled));
  const featuredList = filterBundles(bundles.filter((b) => b.category === "official" || b.category === "ecosystem"));

  const getCategoryLabel = (cat: PluginBundle["category"]) => {
    switch (cat) {
      case "core":
        return t("plugins.categoryCore");
      case "official":
        return t("plugins.categoryOfficial");
      case "ecosystem":
        return t("plugins.categoryEcosystem");
      default:
        return t("plugins.categoryCustom");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog plugin-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header plugin-modal-header">
          <div className="plugin-header-title-row">
            <div className="plugin-header-icon-box">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
            <div>
              <div className="modal-title">{t("plugins.title")}</div>
              <div className="plugin-modal-subtitle">{t("plugins.subtitle")}</div>
            </div>
          </div>
          <div className="plugin-header-meta">
            {catalog && (
              <span className="plugin-profile-pill" title={catalog.profileDir}>
                {t("plugins.profile")}: <strong>{catalog.profile}</strong>
              </span>
            )}
            <button
              type="button"
              className="icon-btn plugin-refresh-btn"
              onClick={() => loadData()}
              title={t("plugins.refresh")}
              disabled={loading}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "spin" : ""}>
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
            <button type="button" className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="plugin-tabs-bar">
          <button
            type="button"
            className={`plugin-tab-btn ${activeTab === "installed" ? "active" : ""}`}
            onClick={() => setActiveTab("installed")}
          >
            {t("plugins.tabInstalled")}
            <span className="plugin-tab-count">
              {catalog?.bundles.filter((b) => b.installed || b.enabled).length ?? 0}
            </span>
          </button>
          <button
            type="button"
            className={`plugin-tab-btn ${activeTab === "featured" ? "active" : ""}`}
            onClick={() => setActiveTab("featured")}
          >
            {t("plugins.tabFeatured")}
            <span className="plugin-tab-count">
              {catalog?.bundles.filter((b) => b.category === "official" || b.category === "ecosystem").length ?? 0}
            </span>
          </button>
          <button
            type="button"
            className={`plugin-tab-btn ${activeTab === "install" ? "active" : ""}`}
            onClick={() => setActiveTab("install")}
          >
            {t("plugins.tabInstall")}
          </button>
        </div>

        {/* Body Content */}
        <div className="plugin-body-container">
          {error && <div className="plugin-error-banner">{error}</div>}

          {/* Search bar for list views */}
          {activeTab !== "install" && (
            <div className="plugin-search-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                className="plugin-search-input"
                placeholder={t("plugins.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="plugin-search-clear"
                  onClick={() => setSearchQuery("")}
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Tab 1: Installed Plugins */}
          {activeTab === "installed" && (
            <div className="plugin-list-scroll">
              {installedList.length === 0 ? (
                <div className="plugin-empty-box">{t("plugins.emptyInstalled")}</div>
              ) : (
                installedList.map((bundle) => {
                  const isBusy = operatingMap[bundle.name];
                  return (
                    <div key={bundle.name} className={`plugin-card ${bundle.enabled ? "enabled" : "disabled"}`}>
                      <div className="plugin-card-left">
                        <div className="plugin-card-title-row">
                          <span className="plugin-card-title">{bundle.title || bundle.name}</span>
                          <span className={`plugin-category-badge ${bundle.category}`}>
                            {getCategoryLabel(bundle.category)}
                          </span>
                          {bundle.version && (
                            <span className="plugin-version-badge">{bundle.version}</span>
                          )}
                        </div>
                        <div className="plugin-card-pkg-name">{bundle.name}</div>
                        <div className="plugin-card-desc">{bundle.description}</div>
                      </div>
                      <div className="plugin-card-actions">
                        {bundle.core ? (
                          <span className="plugin-core-tag">{t("plugins.categoryCore")}</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`plugin-toggle-btn ${bundle.enabled ? "on" : "off"}`}
                              onClick={() => handleToggle(bundle)}
                              disabled={isBusy}
                            >
                              {bundle.enabled ? t("plugins.disable") : t("plugins.enable")}
                            </button>
                            {bundle.category === "custom" && (
                              <button
                                type="button"
                                className="plugin-delete-btn"
                                onClick={() => handleUninstall(bundle)}
                                disabled={isBusy}
                                title={t("plugins.uninstall")}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Tab 2: Featured Extensions */}
          {activeTab === "featured" && (
            <div className="plugin-list-scroll">
              {featuredList.map((bundle) => {
                const isBusy = operatingMap[bundle.name];
                return (
                  <div key={bundle.name} className={`plugin-card ${bundle.enabled ? "enabled" : "disabled"}`}>
                    <div className="plugin-card-left">
                      <div className="plugin-card-title-row">
                        <span className="plugin-card-title">{bundle.title || bundle.name}</span>
                        <span className={`plugin-category-badge ${bundle.category}`}>
                          {getCategoryLabel(bundle.category)}
                        </span>
                      </div>
                      <div className="plugin-card-pkg-name">{bundle.name}</div>
                      <div className="plugin-card-desc">{bundle.description}</div>
                    </div>
                    <div className="plugin-card-actions">
                      <button
                        type="button"
                        className={`plugin-toggle-btn ${bundle.enabled ? "on" : "off"}`}
                        onClick={() => handleToggle(bundle)}
                        disabled={isBusy}
                      >
                        {bundle.enabled ? t("plugins.disable") : t("plugins.enable")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 3: Install Plugin */}
          {activeTab === "install" && (
            <div className="plugin-install-view">
              <div className="plugin-install-form">
                <div className="form-item">
                  <label>{t("plugins.tabInstall")}</label>
                  <div className="plugin-input-group">
                    <input
                      type="text"
                      className="zcode-input plugin-spec-input"
                      placeholder={t("plugins.installSpecPlaceholder")}
                      value={installSpec}
                      onChange={(e) => setInstallSpec(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && installSpec.trim() && !isInstalling) {
                          handleInstall();
                        }
                      }}
                    />
                    <select
                      className="plugin-registry-select"
                      value={selectedRegistry}
                      onChange={(e) => setSelectedRegistry(e.target.value)}
                    >
                      <option value="https://registry.npmjs.org/">{t("plugins.registryOfficial")}</option>
                      <option value="https://registry.npmmirror.com/">{t("plugins.registryMirror")}</option>
                    </select>
                  </div>
                </div>

                <div className="plugin-install-btn-row">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleInspect}
                    disabled={isInspecting || isInstalling || !installSpec.trim()}
                  >
                    {isInspecting ? t("plugins.inspecting") : t("plugins.inspect")}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleInstall}
                    disabled={isInstalling || !installSpec.trim()}
                  >
                    {isInstalling ? t("plugins.installing") : t("plugins.install")}
                  </button>
                </div>

                {/* Inspection preview card */}
                {inspectedInfo && (
                  <div className="plugin-inspect-card">
                    <div className="plugin-inspect-header">
                      <strong>{inspectedInfo.name}</strong>
                      <span className="plugin-version-badge">v{inspectedInfo.version}</span>
                    </div>
                    {inspectedInfo.description && (
                      <p className="plugin-inspect-desc">{inspectedInfo.description}</p>
                    )}
                    {inspectedInfo.dsh && (
                      <div className="plugin-inspect-dsh-badge">✓ Declares DeepSeek Harness Bundle</div>
                    )}
                  </div>
                )}
              </div>

              {/* Real-time installation terminal output */}
              <div className="plugin-log-wrapper">
                <div className="plugin-log-header">
                  <span>{t("plugins.terminalLogs")}</span>
                  {installLogs.length > 0 && (
                    <button
                      type="button"
                      className="plugin-log-clear-btn"
                      onClick={() => setInstallLogs([])}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div ref={terminalRef} className="plugin-log-terminal">
                  {installLogs.length === 0 ? (
                    <span className="plugin-log-placeholder">Ready to install. Output will stream here.</span>
                  ) : (
                    installLogs.map((chunk, i) => (
                      <span key={i} className="plugin-log-line">
                        {chunk}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Inline Toast Notification */}
        {toast && <div className="plugin-toast-pill">{toast}</div>}
      </div>

      {dialog && (
        <div onClick={(e) => e.stopPropagation()}>
          <AppDialog request={dialog} onClose={() => setDialog(null)} />
        </div>
      )}
    </div>
  );
}
