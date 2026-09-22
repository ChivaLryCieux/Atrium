import type { ThemeMode } from "../themes";

import type { ApiProtocol } from "../providers/protocols";

export type ProviderModel = {
  id: string;
  name: string;
  contextLength?: number | null;
};

export type AiProfile = {
  id: string;
  name: string;
  description: string;
  avatar: string;
  endpoint: string;
  apiKey: string;
  /// Wire protocol of the provider's inference endpoint.
  apiProtocol?: ApiProtocol | null;
  model: string;
  models: ProviderModel[];
  systemPrompt: string;
  temperature: number;
};

export type OrchestrationMode = "single" | "parallel" | "dag";

export type ReasoningEffort = "off" | "low" | "high" | "max";

export type ExecutionMode = "plan" | "ask" | "auto";

export type AppSettings = {
  userName: string;
  aiProfiles: AiProfile[];
  orchestrationMode: OrchestrationMode;
  reasoningEffort?: ReasoningEffort | null;
  executionMode?: ExecutionMode | null;
  themeMode?: ThemeMode | null;
  fontSize?: "13px" | "14px" | "15px" | null;
  activeSoul?: string | null;
  /// Provider (AiProfile id) picked in the model selector; persisted.
  activeProfileId?: string | null;
  /// Model name picked in the model selector (within activeProfileId).
  selectedModel?: string | null;
};

export type ToolCallItem = {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  isError?: boolean;
  error?: string;
  status: "running" | "completed" | "error";
  turn?: number;
  step?: number;
  timestamp?: number;
};

export type TokenUsageDetail = {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
};

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  speakerId?: string;
  speakerName: string;
  avatar: string;
  pending?: boolean;
  error?: boolean;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  toolCalls?: ToolCallItem[] | null;
  statusDetail?: string | null;
};

export type PendingMessage = ChatMessage & {
  role: "assistant";
  speakerId: string;
  pending: true;
};

export type OrchestrationStage = {
  id: string;
  title: string;
  role: string;
  instruction: string;
  profile: AiProfile;
  dependsOn: string[];
};

/// Matches the Rust OrchestrationProgress struct.
export type OrchestrationProgressEvent = {
  stageId: string;
  stageTitle: string;
  profileName: string;
  status: "running" | "completed" | "error";
  content?: string;
  messageId?: string;
};

export type ModelUsageStats = {
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  totalLatencyMs: number;
};

export type TokenMetrics = {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalRequests: number;
  totalLatencyMs: number;
  models: ModelUsageStats[];
  projects: ProjectUsageStats[];
};

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  projectId?: string | null;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  directories: string[];
  defaultDirectory?: string | null;
  createdAt: number;
};

export type ProjectUsageStats = {
  projectId: string;
  projectName: string;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  totalLatencyMs: number;
  models: ModelUsageStats[];
};

export type Soul = {
  folder: string;
  name: string;
  description: string;
  content: string;
  isDefault: boolean;
};

