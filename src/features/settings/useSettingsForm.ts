import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, AiProfile, ProviderModel, TokenMetrics } from "../../types/chat";
import { AppDialogRequest } from "../../components/AppDialog";
import { resolveProfileProtocol, splitBaseUrl } from "../../providers/protocols";

export type SettingsTab = "general" | "appearance" | "model" | "tokens" | "shortcuts";

export function useSettingsForm({
  settings,
  onSaveSettings,
}: {
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const [userName, setUserName] = useState(settings.userName);
  const [activeProfileId, setActiveProfileId] = useState<string>(
    settings.aiProfiles[0]?.id || ""
  );
  const [tokenMetrics, setTokenMetrics] = useState<TokenMetrics | null>(null);
  const [dialog, setDialog] = useState<AppDialogRequest | null>(null);

  const currentProfile =
    settings.aiProfiles.find((p) => p.id === activeProfileId) ||
    settings.aiProfiles[0];

  const [baseUrlInput, setBaseUrlInput] = useState(() =>
    splitBaseUrl(currentProfile?.endpoint || "")
  );

  useEffect(() => {
    setBaseUrlInput(splitBaseUrl(currentProfile?.endpoint || ""));
  }, [currentProfile?.id]);

  useEffect(() => {
    if (activeTab === "tokens") {
      invoke<TokenMetrics>("get_token_statistics")
        .then((data) => setTokenMetrics(data))
        .catch((err) => console.error(tRef.current("settings.fetchTokensFailed"), err));
    }
  }, [activeTab]);

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

  const handleResetTokens = async () => {
    try {
      const reset = await invoke<TokenMetrics>("reset_token_statistics");
      setTokenMetrics(reset);
    } catch (err) {
      console.error(tRef.current("settings.resetTokensFailed"), err);
    }
  };

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

  const profileIndex = settings.aiProfiles.findIndex((p) => p.id === currentProfile?.id);

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
        model: currentProfile.model,
      });
      showAlert(t("settings.probeOkMessage", { message }));
    } catch (err) {
      showAlert(t("settings.probeFailMessage", { message: String(err) }), "danger");
    }
  };

  const handleAddModel = () => {
    if (!currentProfile) return;
    const nextModels: ProviderModel[] = [
      ...currentProfile.models,
      { id: crypto.randomUUID(), name: "", contextLength: 256000 },
    ];
    handleUpdateCurrentProfile({ models: nextModels });
  };

  const handleUpdateModel = (modelId: string, patch: Partial<ProviderModel>) => {
    if (!currentProfile) return;
    const oldModel = currentProfile.models.find((m) => m.id === modelId);
    const nextModels = currentProfile.models.map((m) => (m.id === modelId ? { ...m, ...patch } : m));
    const profilePatch: Partial<AiProfile> = { models: nextModels };
    if (patch.name !== undefined && oldModel && currentProfile.model === oldModel.name) {
      profilePatch.model = patch.name.trim();
    }
    handleUpdateCurrentProfile(profilePatch);
  };

  const handleRemoveModel = (modelId: string) => {
    if (!currentProfile) return;
    const remaining = currentProfile.models.filter((m) => m.id !== modelId);
    const removed = currentProfile.models.find((m) => m.id === modelId);
    const profilePatch: Partial<AiProfile> = { models: remaining };
    if (removed && currentProfile.model === removed.name) {
      profilePatch.model = remaining[0]?.name ?? "";
    }
    handleUpdateCurrentProfile(profilePatch);
  };

  return {
    activeTab,
    setActiveTab,
    userName,
    setUserName,
    activeProfileId,
    setActiveProfileId,
    currentProfile,
    profileIndex,
    baseUrlInput,
    setBaseUrlInput,
    tokenMetrics,
    dialog,
    setDialog,
    showConfirm,
    showAlert,
    handleSaveGeneral,
    handleAddProvider,
    handleDeleteProvider,
    handleProbeProvider,
    handleUpdateCurrentProfile,
    handleAddModel,
    handleUpdateModel,
    handleRemoveModel,
    handleResetTokens,
  };
}
