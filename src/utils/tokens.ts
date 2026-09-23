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
