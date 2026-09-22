/**
 * API protocol registry — the single source of truth for provider wire
 * protocols.
 *
 * `AiProfile.endpoint` remains the only persisted URL and is always the
 * *inference endpoint* (base + protocol suffix). Base URL is a derived view
 * (`splitBaseUrl`) used by the settings form; editing Base URL or switching
 * protocol rewrites `endpoint` via `deriveEndpoint`. Legacy profiles without
 * `apiProtocol` are inferred from their endpoint suffix.
 */

export type ApiProtocol = "openai-chat" | "openai-responses" | "anthropic-messages";

export interface ProtocolDefinition {
  id: ApiProtocol;
  /// Path appended to the base URL to form the inference endpoint.
  endpointSuffix: string;
  nameKey: string;
  descriptionKey: string;
}

export const API_PROTOCOLS: readonly ProtocolDefinition[] = [
  {
    id: "openai-chat",
    endpointSuffix: "/chat/completions",
    nameKey: "settings.protocolOpenaiChat",
    descriptionKey: "settings.protocolOpenaiChatDesc",
  },
  {
    id: "openai-responses",
    endpointSuffix: "/responses",
    nameKey: "settings.protocolOpenaiResponses",
    descriptionKey: "settings.protocolOpenaiResponsesDesc",
  },
  {
    id: "anthropic-messages",
    endpointSuffix: "/v1/messages",
    nameKey: "settings.protocolAnthropicMessages",
    descriptionKey: "settings.protocolAnthropicMessagesDesc",
  },
];

export const DEFAULT_API_PROTOCOL: ApiProtocol = "openai-chat";

/// Endpoint suffixes of every protocol, longest first so that a suffix which
/// is itself a prefix of another (e.g. none today, but future-proof) strips
/// deterministically.
const SUFFIXES: readonly string[] = API_PROTOCOLS.map((p) => p.endpointSuffix);

function stripKnownSuffix(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  for (const suffix of SUFFIXES) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, trimmed.length - suffix.length).replace(/\/+$/, "");
    }
  }
  return trimmed;
}

/// Accept any stored value (null, garbage, legacy) and return a valid
/// protocol. Unknown values fall back to the default.
export function normalizeApiProtocol(value: unknown): ApiProtocol {
  if (typeof value !== "string") return DEFAULT_API_PROTOCOL;
  const trimmed = value.trim();
  return API_PROTOCOLS.some((p) => p.id === trimmed)
    ? (trimmed as ApiProtocol)
    : DEFAULT_API_PROTOCOL;
}

/// Legacy migration: detect the protocol from a full endpoint URL.
/// Returns null when no known suffix matches.
export function inferProtocolFromEndpoint(endpoint: string): ApiProtocol | null {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  for (const protocol of API_PROTOCOLS) {
    if (trimmed.endsWith(protocol.endpointSuffix)) return protocol.id;
  }
  return null;
}

/// The base URL for display/editing: the endpoint with any known protocol
/// suffix removed.
export function splitBaseUrl(endpoint: string): string {
  return stripKnownSuffix(endpoint);
}

/// Compose a full inference endpoint from a base URL and a protocol. Any
/// known suffix already present on the input is replaced, so switching
/// protocols never accumulates paths.
export function deriveEndpoint(baseUrl: string, protocol: ApiProtocol): string {
  const suffix =
    API_PROTOCOLS.find((p) => p.id === protocol)?.endpointSuffix ??
    API_PROTOCOLS.find((p) => p.id === DEFAULT_API_PROTOCOL)!.endpointSuffix;
  let base = stripKnownSuffix(baseUrl);
  if (suffix.startsWith("/v1/") && base.endsWith("/v1")) {
    base = base.slice(0, base.length - 3).replace(/\/+$/, "");
  }
  return base ? `${base}${suffix}` : "";
}

/// The protocol a profile should be treated as: explicit value first, then
/// the suffix inferred from the endpoint, then the default.
export function resolveProfileProtocol(
  apiProtocol: string | null | undefined,
  endpoint: string,
): ApiProtocol {
  if (typeof apiProtocol === "string" && apiProtocol.trim()) {
    const candidate = apiProtocol.trim();
    if (API_PROTOCOLS.some((p) => p.id === candidate)) return candidate as ApiProtocol;
  }
  return inferProtocolFromEndpoint(endpoint) ?? DEFAULT_API_PROTOCOL;
}
