import { config } from './config.js';

export class LlmError extends Error {
  constructor(status, detail) {
    super(`LLM provider error (HTTP ${status}): ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

export function normalizeChatUrl(baseUrl) {
  let u = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('baseUrl wajib diisi');
  if (/\/chat\/completions$/.test(u)) return u;
  if (/\/v\d+\/?$/.test(u)) return `${u}/chat/completions`;
  return `${u}/chat/completions`;
}

function normalizeHeaders(apiKey, extra) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export async function chatCompletion({ baseUrl, apiKey, model, messages, stream = true, signal, maxTokens }) {
  const url = normalizeChatUrl(baseUrl);
  const body = { model, messages, stream, temperature: 0.3, max_tokens: maxTokens ?? 4096 };
  const control = signal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, AbortSignal.timeout(config.llmTimeoutMs)])
    : (signal || AbortSignal.timeout(config.llmTimeoutMs));
  const res = await fetch(url, {
    method: 'POST',
    headers: normalizeHeaders(apiKey),
    body: JSON.stringify(body),
    signal: control,
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    throw new LlmError(res.status, detail);
  }
  if (!stream) {
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  }
  return res.body;
}

export async function streamText(res, onDelta) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        /* partial line / non-json payload */
        continue;
      }
      if (json.error) {
        throw new LlmError(json.error.code ? Number(json.error.code) : 0, json.error.message || 'LLM error');
      }
      const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? '';
      if (delta) onDelta(delta);
    }
  }
}