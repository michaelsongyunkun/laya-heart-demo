// Gemma through our own llama.cpp server instead of Ollama's chat API, for one reason: speed.
//
// Gemma 4 uses sliding-window attention. Ollama runs it without the full-size window cache, so
// it reuses an earlier prompt only when the new prompt is identical; every new chat line made it
// read the whole ~400-token prompt again (6.5–9.4 s on an i5-13420H at ~55 tokens/s). Started
// with --swa-full, llama-server keeps what it has read, and a new line only costs the new tokens
// (measured 2026-10-14: 208–279 of ~400 tokens came from the cache).
//
// Which llama-server: one named in settings or LAYA_HEART_LLAMA_SERVER, else the official build
// the first start downloads (setup/), else the one Ollama 0.40+ ships next to its runners. The
// model is a GGUF file: ours, or the one Ollama already pulled (found through Ollama's manifest),
// see server/engines.js. Talks to 127.0.0.1 only.
//
// llama-server answers any web page by default (it allows every origin), so a page open in the
// browser could use the model, taking the CPU and pushing our cached prompt out. Each server
// therefore gets a random key when it starts; only our requests carry it (/health stays open).
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const DEFAULT_MODEL = "gemma4:e2b";
export const SAMPLING = { temperature: 0.8, top_p: 0.95, top_k: 64 };
const ALIAS = "laya-heart-draft"; // also marks our process on the command line

/** Where Ollama keeps its models (OLLAMA_MODELS, else the per-user default). */
export function ollamaModelsDir(env = process.env) {
  return env.OLLAMA_MODELS || path.join(os.homedir(), ".ollama", "models");
}

/**
 * "gemma4:e2b" -> the manifest path parts, Ollama's way ("library/" for plain names). Newer Ollama
 * (0.40.5 here) keeps them in manifests-v2 under the host ollama.com (`v2`); older ones in manifests.
 */
export function manifestPath(modelsDir, model, { v2 = false } = {}) {
  const [name, tag = "latest"] = String(model).split(":");
  const parts = name.split("/");
  const host = parts.length === 3 ? parts[0] : v2 ? "ollama.com" : "registry.ollama.ai";
  const ns = parts.length >= 2 ? parts[parts.length - 2] : "library";
  return path.join(modelsDir, v2 ? "manifests-v2" : "manifests", host, ns, parts[parts.length - 1], tag);
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/**
 * The manifest Ollama serves for a model: the manifests-v2 one when there is one (`ollama create` on
 * 0.40.5 writes only that; a pulled model's is a list whose GGUF entry is a manifest stored as a
 * blob), else the old one.
 */
function readManifest(modelsDir, model) {
  let m = readJson(manifestPath(modelsDir, model, { v2: true }));
  if (Array.isArray(m?.manifests)) {
    const entry = m.manifests.find((e) => (e.format ?? "gguf") === "gguf" && e.digest);
    m = entry ? readJson(path.join(modelsDir, "blobs", entry.digest.replace(":", "-"))) : null;
  }
  return Array.isArray(m?.layers) ? m : readJson(manifestPath(modelsDir, model));
}

/** The GGUF files behind an Ollama model: {model, draft, projector} paths, or null. */
export function resolveOllamaGguf(model = DEFAULT_MODEL, modelsDir = ollamaModelsDir()) {
  const manifest = readManifest(modelsDir, model);
  if (!manifest) return null;
  if (manifest.format && manifest.format !== "gguf") return null;
  const blob = (type) => {
    const layer = (manifest.layers || []).find((l) => l.mediaType === `application/vnd.ollama.image.${type}`);
    if (!layer) return null;
    const file = path.join(modelsDir, "blobs", layer.digest.replace(":", "-"));
    return fs.existsSync(file) ? file : null;
  };
  const main = blob("model");
  return main ? { model: main, draft: blob("draft"), projector: blob("projector") } : null;
}

/** Candidate llama-server executables, most specific first; `downloaded`: the official build the
 *  first start puts in the data folder (faster than Ollama's: it reads ~30% more tokens a second). */
export function llamaServerCandidates(custom, env = process.env, platform = process.platform, { downloaded } = {}) {
  const out = [];
  if (custom) out.push(custom);
  if (env.LAYA_HEART_LLAMA_SERVER) out.push(env.LAYA_HEART_LLAMA_SERVER);
  if (downloaded) out.push(downloaded);
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    out.push(path.join(local, "Programs", "Ollama", "lib", "ollama", "llama-server.exe"));
  } else if (platform === "darwin") {
    out.push("/Applications/Ollama.app/Contents/Resources/llama-server");
    out.push("/Applications/Ollama.app/Contents/Resources/lib/ollama/llama-server");
  } else {
    out.push("/usr/local/lib/ollama/llama-server", "/usr/lib/ollama/llama-server");
  }
  return out;
}

export function findLlamaServer(custom, env = process.env, platform = process.platform, opts = {}) {
  return llamaServerCandidates(custom, env, platform, opts).find((f) => {
    try { return fs.statSync(f).isFile(); } catch { return false; }
  }) || null;
}

/** Same rule as Laya (judge/laya_local.js): half the logical cores, at most 6. */
export function draftThreads(setting, cpus = os.availableParallelism?.() ?? os.cpus().length) {
  const n = Math.trunc(Number(setting));
  if (n > 0) return n;
  return Math.max(1, Math.min(6, Math.floor(cpus / 2)));
}

/** swaFull false only for measuring what the full window buys (LAYA_HEART_SWA_FULL=0). */
export function serverArgs({ model, port, ctx = 4096, threads, cacheRamMiB = 256, swaFull = true, apiKey }) {
  return [
    "-m", model,
    "--host", "127.0.0.1", "--port", String(port),
    ...(apiKey ? ["--api-key", apiKey] : []), // other pages in the browser get 401
    "-c", String(ctx), "-np", "1",
    "-t", String(threads),
    ...(swaFull ? ["--swa-full"] : []), // keep the whole window: what is read once is never read again
    "--cache-ram", String(cacheRamMiB), // bounded host copy of older prompts
    "--jinja", "--no-webui",
    "--alias", ALIAS,
  ];
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Reads an OpenAI-style SSE stream; calls onEvent(json) for each data line. */
export async function readSse(res, onEvent, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      if (onEvent(JSON.parse(data)) === false) {
        await reader.cancel().catch(() => {});
        return;
      }
    }
  }
}

export class LlamaServer {
  /**
   * @param {{exe: string, model: string, ctx?: number, threads?: number, log?: (line: string) => void}} opts
   */
  constructor({ exe, model, ctx = 4096, threads, log, swaFull = process.env.LAYA_HEART_SWA_FULL !== "0",
    extraArgs = (process.env.LAYA_HEART_LLAMA_ARGS || "").split(" ").filter(Boolean) } = {}) {
    this.exe = exe;
    this.model = model;
    this.ctx = ctx;
    this.swaFull = swaFull;
    this.extraArgs = extraArgs; // for tuning runs only
    this.threads = draftThreads(threads);
    this.apiKey = crypto.randomBytes(24).toString("base64url"); // a new one for every server
    this.log = log || (() => {});
    this.proc = null;
    this.base = null;
    this.port = null;
    this.loadMs = null;
    this.starting = null;
    this.exitInfo = null;
  }

  get alive() {
    return !!this.proc && this.proc.exitCode == null && !this.proc.killed;
  }

  /** What every request to this server needs besides /health. */
  authHeaders() {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  info() {
    return { exe: this.exe, model: this.model, port: this.port, threads: this.threads, ctx: this.ctx,
      swaFull: this.swaFull, loadMs: this.loadMs, alive: this.alive, exit: this.exitInfo };
  }

  /** Start the server and wait until it answers /health. Safe to call again. */
  start({ timeoutMs = 120000 } = {}) {
    if (this.alive && this.base) return Promise.resolve(this.info());
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const t0 = performance.now();
      this.port = await freePort();
      this.base = `http://127.0.0.1:${this.port}`;
      const args = [...serverArgs({ model: this.model, port: this.port, ctx: this.ctx, threads: this.threads, swaFull: this.swaFull,
        apiKey: this.apiKey }), ...this.extraArgs];
      this.exitInfo = null;
      const proc = spawn(this.exe, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      this.proc = proc;
      const tail = [];
      const keep = (d) => {
        for (const line of String(d).split(/\r?\n/)) {
          if (!line.trim()) continue;
          tail.push(line);
          if (tail.length > 30) tail.shift();
          this.log(line);
        }
      };
      proc.stdout.on("data", keep);
      proc.stderr.on("data", keep);
      proc.on("exit", (code, sig) => {
        this.exitInfo = { code, signal: sig, tail: tail.slice(-8) };
        if (this.proc === proc) this.proc = null;
      });
      proc.on("error", (e) => { // e.g. ENOENT: the file is not there or cannot run
        this.exitInfo = { error: String(e.message || e), tail: tail.slice(-8) };
        if (this.proc === proc) this.proc = null;
      });
      const deadline = performance.now() + timeoutMs;
      for (;;) {
        if (proc.exitCode != null || this.proc !== proc) {
          const why = this.exitInfo?.error || tail.slice(-3).join(" | ");
          throw new Error(`llama-server exited (${proc.exitCode}): ${String(why).slice(0, 300)}`);
        }
        try {
          const r = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(1000) });
          if (r.ok) break;
        } catch { /* still loading */ }
        if (performance.now() > deadline) {
          this.stop();
          throw new Error("llama-server did not become ready in time");
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      this.loadMs = Math.round(performance.now() - t0);
      return this.info();
    })();
    return this.starting.finally(() => { this.starting = null; });
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    if (p && p.exitCode == null) {
      try { p.kill(); } catch { /* already gone */ }
    }
  }

  /**
   * One streamed chat completion. `stopWhen(text)` may end it early (e.g. once enough reply
   * lines are complete); the connection is closed and llama-server stops writing.
   * Resolves with {text, firstTokenMs, promptN, cacheN, promptMs, evalCount, evalMs, totalMs}.
   */
  async complete(messages, { maxTokens = 160, onDelta, stopWhen, signal, sampling = SAMPLING } = {}) {
    if (!this.alive) await this.start();
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(`${this.base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({
          model: ALIAS, messages, stream: true, max_tokens: maxTokens, cache_prompt: true,
          chat_template_kwargs: { enable_thinking: false }, ...sampling,
        }),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new Error(`LLAMA_SERVER_UNREACHABLE ${this.base}`);
    }
    if (!res.ok) throw new Error(`llama-server HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    let text = "";
    let firstTokenMs = null;
    let timings = null;
    let stopped = false;
    await readSse(res, (ev) => {
      if (ev.timings) timings = ev.timings;
      const piece = ev.choices?.[0]?.delta?.content || "";
      if (!piece) return true;
      firstTokenMs ??= Math.round(performance.now() - t0);
      text += piece;
      onDelta?.(text);
      if (stopWhen?.(text)) {
        stopped = true;
        return false;
      }
      return true;
    }, signal);
    return {
      text, firstTokenMs, stoppedEarly: stopped,
      promptN: timings?.prompt_n ?? null, cacheN: timings?.cache_n ?? null,
      promptMs: timings ? Math.round(timings.prompt_ms) : null,
      evalCount: timings?.predicted_n ?? null, evalMs: timings ? Math.round(timings.predicted_ms) : null,
      totalMs: Math.round(performance.now() - t0),
    };
  }

  /** Read a prompt into the cache without writing anything (warm-up). */
  async prefill(messages, { signal } = {}) {
    return this.complete(messages, { maxTokens: 1, signal });
  }

  /**
   * Give back the memory only loading needed (Windows; call right after start()). The CPU backend
   * reads every weight once to lay it out again for faster multiplication and runs on that copy;
   * the pages it read from the mapped model file (~0.9 GB for gemma4:e2b) are never used again,
   * yet stay counted to the process until Windows runs short of memory. Taking all pages out once
   * lets the next read bring back only those in use: 2.45 -> 1.6 GB after a bench run, and no
   * slower in alternating runs (2026-10-14). Turning the re-layout off (--no-repack) saves a little
   * less (1.74 GB) but made every turn 13-17% slower. LAYA_HEART_TRIM=0 skips it. Resolves whether
   * it trimmed.
   */
  trimAfterLoad() {
    if (process.platform !== "win32" || !this.alive || process.env.LAYA_HEART_TRIM === "0") return Promise.resolve(false);
    return trimWorkingSet(this.proc.pid);
  }
}

/** Windows: take every page out of a process's working set (EmptyWorkingSet); pages in use come back. */
export function trimWorkingSet(pid) {
  const ps = `Add-Type -Name W -Namespace LayaHeart -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h);'; [LayaHeart.W]::EmptyWorkingSet((Get-Process -Id ${Number(pid)}).Handle)`;
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 20000 },
      (err, out) => resolve(!err && /True/.test(String(out))));
  });
}
