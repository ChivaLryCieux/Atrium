import { AiProfile } from "../types/chat";

/**
 * Token accounting is append-only: kernel attempt/retry notifications may
 * arrive out of order with smaller values, so never let a counter regress.
 */
export function mergeTokenHighWaterMark(
  current: { promptTokens?: number | null; completionTokens?: number | null },
  usage: { inputTokens: number; outputTokens: number },
): { promptTokens: number; completionTokens: number } {
  return {
    promptTokens: Math.max(current.promptTokens ?? 0, usage.inputTokens),
    completionTokens: Math.max(current.completionTokens ?? 0, usage.outputTokens),
  };
}

/**
 * Fast, accurate BPE & CJK token estimator mirroring the backend tokens.rs.
 * Accurately tracks token usage without heavy tokenizer dependencies.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  let count = 0;
  let asciiWordChars = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // ASCII character
    if (code <= 127) {
      const isAlphanumeric =
        (code >= 48 && code <= 57) || // 0-9
        (code >= 65 && code <= 90) || // A-Z
        (code >= 97 && code <= 122); // a-z
      if (isAlphanumeric) {
        asciiWordChars++;
      } else {
        if (asciiWordChars > 0) {
          count += Math.floor((asciiWordChars + 3) / 4);
          asciiWordChars = 0;
        }
        // Non-whitespace ASCII punctuation counts as 1 token
        const isWhitespace = code === 32 || code === 9 || code === 10 || code === 13;
        if (!isWhitespace) {
          count++;
        }
      }
    } else {
      // Non-ASCII (CJK, emoji, unicode symbols)
      if (asciiWordChars > 0) {
        count += Math.floor((asciiWordChars + 3) / 4);
        asciiWordChars = 0;
      }
      // CJK characters count as 1 to 1.5 tokens
      count++;
    }
  }

  if (asciiWordChars > 0) {
    count += Math.floor((asciiWordChars + 3) / 4);
  }

  return Math.max(count, 1);
}

const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, number>();

export function estimateTokensCached(text: string): number {
  if (!text) return 0;
  if (text.length > 50000) {
    return estimateTokens(text);
  }
  const cached = tokenCache.get(text);
  if (cached !== undefined) {
    return cached;
  }
  const val = estimateTokens(text);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const iter = tokenCache.keys();
    for (let i = 0; i < Math.floor(TOKEN_CACHE_MAX / 2); i++) {
      const next = iter.next();
      if (next.done) break;
      tokenCache.delete(next.value);
    }
  }
  tokenCache.set(text, val);
  return val;
}

/**
 * Resolves the ceiling context window for the active model.
 * Atrium models use 256K (256,000) or 1M (1,000,000).
 */
export function resolveContextCeiling(
  modelName: string | undefined,
  activeProfile: AiProfile | null
): { value: number; label: string } {
  const model = activeProfile?.models?.find(
    (m) => m.name === modelName || m.id === modelName
  );

  const rawLength = model?.contextLength;
  if (rawLength && Number(rawLength) >= 500000) {
    return { value: 1000000, label: "1M" };
  }

  return { value: 256000, label: "256K" };
}

/**
 * Format context tokens for the gauge ratio display (e.g. 12K, 20K, 256K, 1M).
 */
export function formatContextTokens(tokens: number): string {
  if (tokens <= 0) return "0";
  if (tokens < 1000) return String(tokens);
  if (tokens < 10000) {
    const k = tokens / 1000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
  }
  if (tokens < 1000000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  const m = tokens / 1000000;
  return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
}
