import { dshClient } from "./dshClient";

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

function getBaseUrl(): string {
  const conn = dshClient.getConnection();
  return conn?.url || "http://127.0.0.1:19387";
}

function getHeaders(): Record<string, string> {
  const conn = dshClient.getConnection();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (conn?.token) {
    headers["Authorization"] = `Bearer ${conn.token}`;
  }
  return headers;
}

export async function fetchPluginCatalog(profile = "sdk"): Promise<PluginCatalog> {
  const url = `${getBaseUrl()}/api/plugins?profile=${encodeURIComponent(profile)}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: getHeaders(),
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch plugin catalog: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();
  if (!json.ok) {
    throw new Error(json.error || "Failed to fetch plugins");
  }
  return json.data;
}

export async function toggleBundle(name: string, enabled: boolean, profile = "sdk") {
  const url = `${getBaseUrl()}/api/plugins/bundle/toggle`;
  const resp = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ profile, name, enabled }),
  });
  if (!resp.ok) {
    throw new Error(`Toggle failed: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();
  if (!json.ok) {
    throw new Error(json.error || "Toggle failed");
  }
  return json;
}

export async function togglePatchPlugin(id: string, enabled: boolean, name?: string, profile = "sdk") {
  const url = `${getBaseUrl()}/api/plugins/plugin/toggle`;
  const resp = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ profile, id, name, enabled }),
  });
  if (!resp.ok) {
    throw new Error(`Toggle failed: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();
  if (!json.ok) {
    throw new Error(json.error || "Toggle failed");
  }
  return json;
}

export async function installPlugin(spec: string, registry?: string, profile = "sdk") {
  const url = `${getBaseUrl()}/api/plugins/install`;
  const resp = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ profile, spec, registry }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error || `Install failed: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();
  if (!json.ok) {
    throw new Error(json.error || "Install failed");
  }
  return json;
}

export async function removePlugin(name: string, profile = "sdk") {
  const url = `${getBaseUrl()}/api/plugins/remove`;
  const resp = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ profile, name }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error || `Remove failed: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();
  if (!json.ok) {
    throw new Error(json.error || "Remove failed");
  }
  return json;
}

export async function inspectPlugin(spec: string, registry?: string) {
  const url = `${getBaseUrl()}/api/plugins/inspect`;
  const resp = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ spec, registry }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error || `Inspect failed: ${resp.status}`);
  }
  const json = await resp.json();
  if (!json.ok) {
    throw new Error(json.error || "Inspect failed");
  }
  return json.info;
}
