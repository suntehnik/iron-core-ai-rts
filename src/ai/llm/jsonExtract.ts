/**
 * Pulls the first JSON object out of a model reply. Cheap models (Qwen3 included)
 * sometimes wrap JSON in <think> blocks, markdown fences or a sentence of prose.
 */
export function extractJSONObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // An unterminated <think> block means the model ran out of tokens while reasoning
  t = t.replace(/<think>[\s\S]*$/i, '').trim();
  t = t.replace(/```(?:json)?/gi, '').trim();

  const direct = tryParse(t);
  if (direct) return direct;

  for (let start = t.indexOf('{'); start !== -1; start = t.indexOf('{', start + 1)) {
    const end = findMatchingBrace(t, start);
    if (end === -1) continue;
    const parsed = tryParse(t.slice(start, end + 1));
    if (parsed) return parsed;
  }
  return null;
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function findMatchingBrace(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Rough token estimate when a provider omits usage (Cyrillic ≈ 3 chars per token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}
