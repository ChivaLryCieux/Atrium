import { invoke } from "@tauri-apps/api/core";

/**
 * Plugin management goes through the Tauri command layer like every other
 * frontend↔backend interaction (AGENTS.md §1.5). The Rust proxy attaches the
 * bridge session token server-side; the webview never talks to the kernel
 * bridge HTTP API directly.
 */

export interface PluginBundle {
  name: string;
  title: string;
  description: string;
  category: 'core' | 'official' | 'ecosystem' | 'custom';
  core: boolean;
  enabled: boolean;
  installed: boolean;
  version?: string;
}

export interface PluginPatchEntry {
  id: string;
  name?: string;
  disabled?: boolean;
  [key: string]: any;
}

export interface PluginCatalog {
  profile: string;
  profileDir: string;
  dshHome: string;
  dshRoot: string;
  bundles: PluginBundle[];
  patches: PluginPatchEntry[];
}

type BridgeJson = {
  ok?: boolean;
  error?: string;
  data?: PluginCatalog;
  info?: any;
  [key: string]: any;
};

function unwrap(json: BridgeJson, fallback: string): BridgeJson {
  if (!json || json.ok === false) {
    throw new Error(json?.error || fallback);
  }
  return json;
}

export async function fetchPluginCatalog(profile = "sdk"): Promise<PluginCatalog> {
  const json = await invoke<BridgeJson>("list_plugins", { profile });
  if (!json.ok) {
    throw new Error(json.error || "Failed to fetch plugins");
  }
  return json.data as PluginCatalog;
}

export async function toggleBundle(name: string, enabled: boolean, profile = "sdk") {
  const json = await invoke<BridgeJson>("toggle_plugin_bundle", { name, enabled, profile });
  return unwrap(json, "Toggle failed");
}

export async function togglePatchPlugin(id: string, enabled: boolean, name?: string, profile = "sdk") {
  const json = await invoke<BridgeJson>("toggle_patch_plugin", { id, name, enabled, profile });
  return unwrap(json, "Toggle failed");
}

export async function installPlugin(spec: string, registry?: string, profile = "sdk") {
  const json = await invoke<BridgeJson>("install_plugin", { spec, registry, profile });
  return unwrap(json, "Install failed");
}

export async function removePlugin(name: string, profile = "sdk") {
  const json = await invoke<BridgeJson>("remove_plugin", { name, profile });
  return unwrap(json, "Remove failed");
}

export async function inspectPlugin(spec: string, registry?: string) {
  const json = await invoke<BridgeJson>("inspect_plugin", { spec, registry });
  if (!json.ok) {
    throw new Error(json.error || "Inspect failed");
  }
  return json.info;
}
