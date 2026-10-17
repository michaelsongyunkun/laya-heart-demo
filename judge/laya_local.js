// Laya running in this process via the vendored laya-ts runtime (ONNX, onnxruntime-node).
// No network: Agent.load is only ever given a local directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MODEL_FILES = ["encoder.onnx", "head.onnx", "tokenizer.json", "rl_agent_config.json"];

export function isModelDir(dir) {
  return !!dir && MODEL_FILES.every((f) => fs.existsSync(path.join(dir, f)));
}

// More threads is not faster: on an i5-13420H (4 performance + 4 efficiency cores, 12 threads)
// 4–6 threads beat ONNX Runtime's default by 15–25% and 12 threads take twice as long.
// Half the logical cores, at most 6, unless the settings name a number.
export function layaThreads(setting, cpus = os.availableParallelism?.() ?? os.cpus().length) {
  const n = Math.trunc(Number(setting));
  if (n > 0) return n;
  return Math.max(1, Math.min(6, Math.floor(cpus / 2)));
}

// laya-ts writes its numThreads option to ort.env.numThreads, which only the web runtime reads;
// onnxruntime-node takes the count as a session option, so add it to the sessions Agent.load opens.
// Their threads also wait for work without spinning: Agent.load opens two sessions (encoder and
// head) with a pool each, and spinning kept ~10 cores busy for 6 threads' work and another
// ~0.5 s after every answer, which is when Gemma starts reading the new line. Without it
// (i5-13420H, 2026-10-18): the same answers 13% sooner, 4 cores busy, nothing after.
// LAYA_HEART_LAYA_SPIN=1 spins again (for measuring).
export async function withThreads(threads, load, { spin = process.env.LAYA_HEART_LAYA_SPIN === "1" } = {}) {
  const { InferenceSession } = await import("onnxruntime-node");
  const create = InferenceSession.create;
  const wait = spin ? {} : { extra: { session: { intra_op: { allow_spinning: "0" } } } };
  InferenceSession.create = (src, opts = {}) => create.call(InferenceSession, src, { intraOpNumThreads: threads, ...wait, ...opts });
  try {
    return await load();
  } finally {
    InferenceSession.create = create;
  }
}

export class LayaLocal {
  constructor() {
    this.agent = null;
    this.modelDir = null;
    this.loading = null;
    this.loadMs = null;
    this.threads = null;
  }

  async load(modelDir, { numThreads } = {}) {
    if (this.agent && this.modelDir === modelDir) return this.info();
    if (this.loading) await this.loading.catch(() => {});
    if (!isModelDir(modelDir)) throw new Error(`Laya model not found in ${modelDir}`);
    const t0 = performance.now();
    this.loading = (async () => {
      const { Agent } = await import("../vendor/laya-ts/dist/index.js");
      const threads = layaThreads(numThreads);
      this.agent = await withThreads(threads, () => Agent.load(modelDir, {}));
      this.threads = threads;
      this.modelDir = modelDir;
      this.loadMs = Math.round(performance.now() - t0);
    })();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
    return this.info();
  }

  info() {
    const cfg = path.join(this.modelDir || "", "rl_agent_config.json");
    let encoder = null;
    try { encoder = JSON.parse(fs.readFileSync(cfg, "utf8")).encoder || null; } catch { /* ignore */ }
    return { loaded: !!this.agent, modelDir: this.modelDir, loadMs: this.loadMs, threads: this.threads, encoder };
  }

  async predict(state, questions) {
    if (!this.agent) throw new Error("Laya model is not loaded");
    const t0 = performance.now();
    const out = await this.agent.predict(state, questions);
    return { answers: out.answers, usage: out.usage, ms: Math.round(performance.now() - t0), bytesOut: 0 };
  }

  unload() {
    this.agent = null;
    this.modelDir = null;
  }
}
