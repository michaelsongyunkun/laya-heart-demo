// HTTP judge for any /v1/systemone-shaped service: a local `laya-serve` (e.g. a fine-tuned
// checkpoint before it is exported to ONNX), or Jev (TypeSafe direct / OpenRouter) as the
// closed-source comparison. Remote URLs send the chat off this machine; the panel says so.
//
// URL rule:
// host only -> {base}/v1/systemone; ends with a version segment -> {base}/systemone;
// already ends with an action (/v1/systemone, /v1/evaluate, /api/alpha/decisions) -> as is.

export function requestUrl(base) {
  const b = String(base || "").replace(/\/+$/, "");
  if (/\/(?:systemone|evaluate|decisions)$/.test(b)) return b;
  return b + (/\/v\d+[a-z]*$/.test(b) ? "/systemone" : "/v1/systemone");
}

export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function systemOneJudge({ base, model, key, timeoutMs = 30000 }) {
  const url = requestUrl(base);
  const local = isLocalUrl(url);
  return {
    name: local ? "laya-serve" : "systemone-remote",
    label: local ? `laya-serve (${new URL(url).host})` : `${model} @ ${new URL(url).host}`,
    local,
    async predict(state, questions, { signal } = {}) {
      const body = JSON.stringify({ model, state, questions });
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
          body,
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        });
        if ((res.status === 429 || res.status === 529) && attempt < 3) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        if (!res.ok) {
          const text = (await res.text().catch(() => "")).slice(0, 300);
          const hint = res.status === 401 ? " (key rejected)" : res.status === 422 ? " (request rejected)" : "";
          throw new Error(`judge HTTP ${res.status}${hint}: ${text}`);
        }
        const data = await res.json();
        const answers = data.answers || data.data?.answers;
        if (!answers) throw new Error("judge response has no answers");
        return { answers, usage: data.usage, bytesOut: local ? 0 : Buffer.byteLength(body) };
      }
    },
  };
}
