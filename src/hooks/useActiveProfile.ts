import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AiProfile, AppSettings, OrchestrationStage } from "../types/chat";

export type ActiveProfileState = {
  activeProfile: AiProfile | null;
  orchestrationStages: OrchestrationStage[];
};

/**
 * Active profile resolution + default-model follow + orchestration stage
 * build. Reads settings, writes selected model / stages — no send logic.
 */
export function useActiveProfile(
  settings: AppSettings | null,
  activeProfileId: string,
  setSelectedModel: Dispatch<SetStateAction<string>>,
): ActiveProfileState {
  const activeProfile = useMemo(() => {
    return (
      settings?.aiProfiles.find((p) => p.id === activeProfileId) ||
      settings?.aiProfiles[0] ||
      null
    );
  }, [activeProfileId, settings]);
  const [orchestrationStages, setOrchestrationStages] = useState<OrchestrationStage[]>([]);

  // Follow the active profile's default model on switch.
  useEffect(() => {
    if (activeProfile?.model) {
      setSelectedModel(activeProfile.model);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId]);

  // Build orchestration stages for the pending-bubble fan-out.
  useEffect(() => {
    if (!activeProfile || !settings) return;
    invoke<OrchestrationStage[]>("build_orchestration", {
      profiles: [activeProfile],
    })
      .then(setOrchestrationStages)
      .catch(console.error);
  }, [activeProfile, settings]);

  return { activeProfile, orchestrationStages };
}
