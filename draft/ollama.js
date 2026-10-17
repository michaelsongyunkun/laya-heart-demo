// Minimal Ollama client: status, model list, pull with progress, and streaming chat.
// Talks to the local Ollama server only (default http://127.0.0.1:11434).

export const DEFAULT_OLLAMA = "http://127.0.0.1:11434";
export const DEFAULT_DRAFT_MODEL = "gemma4:e2b";

// Every request for the drafting model sends these. num_ctx is also a load parameter: a request
// with another value makes Ollama load the model again (measured: a warm-up without options
// loaded Gemma with a 4096 context, and the first draft then spent 8.3 s reloading it at 2048).
export const DRAFT_OPTIONS = { temperature: 0.8, top_p: 0.95, num_ctx: 2048, num_predict: 220 };

const ms = (ns) => (ns ? Math.round(ns / 1e6) : null);

async function readLines(res, onLine, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
  if (buf.trim()) onLine(JSON.parse(buf.trim()));
}

export async function ollamaVersion(base = DEFAULT_OLLAMA, timeoutMs = 2500) {
  try {
    const res = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()).version || "unknown";
  } catch {
    return null;
  }
}

export async function listModels(base = DEFAULT_OLLAMA) {
  const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Ollama /api/tags HTTP ${res.status}`);
  return ((await res.json()).models || []).map((m) => ({ name: m.name, size: m.size }));
}

export async function hasModel(base, model) {
  const names = (await listModels(base)).map((m) => m.name);
  const want = model.includes(":") ? model : `${model}:latest`;
  return names.includes(want);
}

/** Pull a model; onProgress({status, completed, total}). Resolves when Ollama reports success. */
export async function pullModel(base, model, onProgress, signal) {
  const res = await fetch(`${base}/api/pull`, {
    method: "POST",
    body: JSON.stringify({ model, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama pull HTTP ${res.status}`);
  let ok = false;
  await readLines(res, (ev) => {
    if (ev.error) throw new Error(ev.error);
    if (ev.status === "success") ok = true;
    onProgress?.(ev);
  }, signal);
  if (!ok) throw new Error("pull did not finish");
}

/** Load the drafting model ahead of the first draft, with the drafting options. */
export async function warmModel(base, model, keepAlive) {
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model, keep_alive: keepAlive, options: DRAFT_OPTIONS }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Ollama generate HTTP ${res.status}`);
  await res.json().catch(() => null);
}

/**
 * Streaming chat. Calls onDelta(textSoFar) as tokens arrive; resolves with
 * {text, evalCount, promptEvalCount, promptMs, evalMs, totalMs, loadMs}.
 */
export async function chatStream(base, model, messages, { onDelta, signal, options = {}, keepAlive = "10m" } = {}) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        think: false,
        keep_alive: keepAlive,
        options: { ...DRAFT_OPTIONS, ...options },
      }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`OLLAMA_UNREACHABLE ${base}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404 && /not found/i.test(body)) throw new Error(`OLLAMA_MODEL_MISSING ${model}`);
    throw new Error(`Ollama chat HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  let text = "";
  let final = null;
  await readLines(res, (ev) => {
    if (ev.error) throw new Error(ev.error);
    const piece = ev.message?.content || "";
    if (piece) {
      text += piece;
      onDelta?.(text);
    }
    if (ev.done) final = ev;
  }, signal);
  return {
    text,
    evalCount: final?.eval_count ?? null,
    promptEvalCount: final?.prompt_eval_count ?? null,
    promptMs: ms(final?.prompt_eval_duration),
    evalMs: ms(final?.eval_duration),
    loadMs: ms(final?.load_duration),
    totalMs: Math.round(performance.now() - t0),
  };
}
