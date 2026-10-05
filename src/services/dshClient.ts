import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface HarnessConnectionInfo {
  status: 'standby' | 'ready' | 'connected' | 'stopped' | 'error';
  url: string;
  port: number;
  token?: string;
  pid?: number;
  message?: string;
}

import type { ToolCallItem, TokenUsageDetail } from "../types/chat";

export interface DshStreamChunk {
  type: 'chunk' | 'start' | 'end' | 'error';
  content?: string;
  stageId?: string;
  speakerName?: string;
  conversationId?: string;
  isReasoning?: boolean;
}

export interface ToolEventMessage {
  type: 'tool-event';
  conversationId: string;
  stageId?: string;
  event:
    | { kind: 'call'; item: ToolCallItem }
    | {
        kind: 'result';
        callId: string;
        turn?: number;
        step?: number;
        result?: string;
        isError?: boolean;
        error?: string;
        status: 'completed' | 'error';
      };
}

export interface TokenUsageMessage {
  type: 'token-usage';
  conversationId: string;
  stageId?: string;
  usage: TokenUsageDetail;
}

export interface AgentStatusMessage {
  type: 'agent-status';
  conversationId: string;
  stageId?: string;
  status: 'thinking' | 'calling_tool' | 'tool_finished' | 'generating' | 'turn_ended';
  detail: string;
  tool?: string;
  callId?: string;
  turn?: number;
  isError?: boolean;
}

export interface KernelStatusEvent {
  status: 'starting' | 'ready' | 'error' | 'missing' | 'stopping';
  detail?: string;
}

export type StreamListener = (chunk: DshStreamChunk) => void;
export type ToolEventListener = (event: ToolEventMessage) => void;
export type TokenUsageListener = (event: TokenUsageMessage) => void;
export type AgentStatusListener = (event: AgentStatusMessage) => void;
export type TelemetryListener = (event: any) => void;
export type KernelStatusListener = (event: KernelStatusEvent) => void;

class DshClient {
  private connection: HarnessConnectionInfo = {
    status: 'standby',
    url: 'http://127.0.0.1:19387',
    port: 19387,
  };
  private ws: WebSocket | null = null;
  private streamListeners: Set<StreamListener> = new Set();
  private toolEventListeners: Set<ToolEventListener> = new Set();
  private tokenUsageListeners: Set<TokenUsageListener> = new Set();
  private agentStatusListeners: Set<AgentStatusListener> = new Set();
  private telemetryListeners: Set<TelemetryListener> = new Set();
  private kernelStatusListeners: Set<KernelStatusListener> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nativeUnlisten: UnlistenFn | null = null;
  private recentEventKeys: Set<string> = new Set();

  async init(): Promise<HarnessConnectionInfo> {
    try {
      let conn = await invoke<HarnessConnectionInfo>('get_harness_connection');
      if (conn.status !== 'ready' && conn.status !== 'connected') {
        conn = await invoke<HarnessConnectionInfo>('start_harness_daemon');
      }
      this.connection = conn;
      this.initNativeMultiplexer();
      this.connectWebSocket();
      return this.connection;
    } catch (error) {
      console.warn('[DshClient] Kernel bridge unavailable, direct-API fallback stays active:', error);
      this.connection.status = 'standby';
      return this.connection;
    }
  }

  ensureConnected(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connectWebSocket();
  }

  private connectWebSocket() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch { /* ignore */ }
      this.ws = null;
    }

    const baseUrl = this.connection.url.replace(/^http/, 'ws') + '/events';
    const wsUrl = this.connection.token
      ? `${baseUrl}?token=${encodeURIComponent(this.connection.token)}`
      : baseUrl;
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.connection.status = 'connected';
        console.log('[DshClient] WebSocket connected to kernel bridge:', wsUrl);
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'assistant-stream') {
            this.streamListeners.forEach((fn) => fn(payload));
          } else if (payload.type === 'tool-event') {
            this.toolEventListeners.forEach((fn) => fn(payload));
          } else if (payload.type === 'token-usage') {
            this.tokenUsageListeners.forEach((fn) => fn(payload));
          } else if (payload.type === 'agent-status') {
            this.agentStatusListeners.forEach((fn) => fn(payload));
          } else if (payload.type === 'telemetry') {
            this.telemetryListeners.forEach((fn) => fn(payload));
          } else if (payload.type === 'kernel-status') {
            this.kernelStatusListeners.forEach((fn) => fn(payload));
          }
        } catch (e) {
          console.error('[DshClient] Failed to parse message:', e);
        }
      };

      this.ws.onclose = () => {
        if (this.connection.status === 'connected') {
          this.connection.status = 'ready';
        }
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectWebSocket();
          }, 3000);
        }
      };

      this.ws.onerror = (e) => {
        console.warn('[DshClient] WS error (normal during bridge startup):', e);
      };
    } catch (err) {
      console.warn('[DshClient] Could not establish WS connection:', err);
    }
  }

  onStream(listener: StreamListener): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  onToolEvent(listener: ToolEventListener): () => void {
    this.toolEventListeners.add(listener);
    return () => this.toolEventListeners.delete(listener);
  }

  onTokenUsage(listener: TokenUsageListener): () => void {
    this.tokenUsageListeners.add(listener);
    return () => this.tokenUsageListeners.delete(listener);
  }

  onAgentStatus(listener: AgentStatusListener): () => void {
    this.agentStatusListeners.add(listener);
    return () => this.agentStatusListeners.delete(listener);
  }

  onTelemetry(listener: TelemetryListener): () => void {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  onKernelStatus(listener: KernelStatusListener): () => void {
    this.kernelStatusListeners.add(listener);
    return () => this.kernelStatusListeners.delete(listener);
  }

  getConnection(): HarnessConnectionInfo {
    return this.connection;
  }

  /**
   * Star-Topology Multiplexer: listens directly to Tauri's native Rust IPC channel.
   * Rust mediates the Bridge SSE stream and multiplexes events without requiring
   * raw TCP WebSocket connectivity, providing resilient offline / reload recovery.
   */
  private async initNativeMultiplexer() {
    if (this.nativeUnlisten) return;
    try {
      this.nativeUnlisten = await listen<any>('kernel-stream-event', (event) => {
        if (event?.payload) {
          this.dispatchPayload(event.payload, 'ipc');
        }
      });
      console.log('[DshClient] Native Rust IPC event multiplexer registered');
    } catch (err) {
      console.debug('[DshClient] Native IPC event listener skipped (web fallback):', err);
    }
  }

  private dispatchPayload(payload: any, source: 'ipc' | 'ws' = 'ws') {
    if (!payload || typeof payload !== 'object') return;

    // Deduplicate identical events received simultaneously over dual channels
    if (payload.conversationId && (payload.turn !== undefined || payload.step !== undefined)) {
      const dedupKey = `${payload.type}:${payload.conversationId}:${payload.turn}:${payload.step}:${payload.stageId || ''}:${payload.content?.slice(0, 30) || ''}`;
      if (this.recentEventKeys.has(dedupKey)) return;
      this.recentEventKeys.add(dedupKey);
      if (this.recentEventKeys.size > 200) {
        // Drop oldest entries
        const iter = this.recentEventKeys.values();
        for (let i = 0; i < 50; i++) {
          const val = iter.next().value;
          if (val) this.recentEventKeys.delete(val);
        }
      }
    }

    if (payload.type === 'assistant-stream') {
      this.streamListeners.forEach((fn) => fn(payload));
    } else if (payload.type === 'tool-event') {
      this.toolEventListeners.forEach((fn) => fn(payload));
    } else if (payload.type === 'token-usage') {
      this.tokenUsageListeners.forEach((fn) => fn(payload));
    } else if (payload.type === 'agent-status') {
      this.agentStatusListeners.forEach((fn) => fn(payload));
    } else if (payload.type === 'telemetry') {
      this.telemetryListeners.forEach((fn) => fn(payload));
    } else if (payload.type === 'kernel-status') {
      this.kernelStatusListeners.forEach((fn) => fn(payload));
    }
  }

}

export const dshClient = new DshClient();
