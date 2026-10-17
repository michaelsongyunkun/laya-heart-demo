// Drafting backends with one shape: { name, label, local, draft(messages, {onDelta, signal}) }.
// Default is Gemma through our own llama-server (draft/llama_server.js: it keeps what it has
// read, so a new chat line costs only the new tokens); Gemma through Ollama's chat API is the
// fallback when no llama-server is found. An OpenAI-compatible endpoint is optional and marked
// as sending text off the machine.
import { chatStream, DEFAULT_OLLAMA, DEFAULT_DRAFT_MODEL } from "./ollama.js";
import { finishedCandidates } from "./parse.js";
import { N_CANDIDATES } from "./prompt.js";
import { isLocalUrl } from "../judge/systemone_http.js";

/** Stop writing once `count` usable reply lines are finished (no third line nobody asked for). */
export const enoughLines = (count = N_CANDIDATES) => (text) => finishedCandidates(text, count).length >= count;

/** @param {import("./llama_server.js").LlamaServer} server */
export function llamaServerDrafter(server, { model = DEFAULT_DRAFT_MODEL, count = N_CANDIDATES, maxTokens = 160 } = {}) {
  return {
    name: "llama-server",
    label: `${model} · llama.cpp`,
    local: true,
    async draft(messages, { onDelta, signal } = {}) {
      const r = await server.complete(messages, { onDelta, signal, maxTokens, stopWhen: enoughLines(count) });
      return { ...r, promptEvalCount: r.promptN, loadMs: 0, bytesOut: 0 };
    },
  };
}

export function ollamaDrafter({ base = DEFAULT_OLLAMA, model = DEFAULT_DRAFT_MODEL, keepAlive = "10m", options } = {}) {
  return {
    name: "ollama",
    label: `${model} · Ollama`,
    local: isLocalUrl(base),
    async draft(messages, { onDelta, signal } = {}) {
      const t0 = performance.now();
      let firstTokenMs = null;
      const r = await chatStream(base, model, messages, {
        signal, keepAlive, options,
        onDelta: (text) => {
          firstTokenMs ??= Math.round(performance.now() - t0);
          onDelta?.(text);
        },
      });
      const bytesOut = isLocalUrl(base) ? 0 : Buffer.byteLength(JSON.stringify(messages));
      return { ...r, firstTokenMs, bytesOut };
    },
  };
}

function chatUrl(base) {
  const b = String(base || "").replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(b)) return b;
  return b + (/\/v\d+[a-z]*$/.test(b) ? "/chat/completions" : "/v1/chat/completions");
}

export function openAiDrafter({ base, model, key, extraBody = {} }) {
  const url = chatUrl(base);
  const local = isLocalUrl(url);
  return {
    name: "openai-compatible",
    label: `${model} @ ${new URL(url).host}`,
    local,
    async draft(messages, { onDelta, signal } = {}) {
      const body = JSON.stringify({ model, messages, stream: true, temperature: 0.8, max_tokens: 220, ...extraBody });
      const t0 = performance.now();
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body,
        signal,
      });
      if (!res.ok) throw new Error(`draft HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let text = "";
      let usage = null;
      let firstTokenMs = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          const ev = JSON.parse(data);
          const piece = ev.choices?.[0]?.delta?.content || "";
          if (piece) {
            firstTokenMs ??= Math.round(performance.now() - t0);
            text += piece;
            onDelta?.(text);
          }
          if (ev.usage) usage = ev.usage;
        }
      }
      return {
        text,
        firstTokenMs,
        evalCount: usage?.completion_tokens ?? null,
        totalMs: Math.round(performance.now() - t0),
        bytesOut: local ? 0 : Buffer.byteLength(body),
      };
    },
  };
}
