// Settings live in <home>/settings.json, home = LAYA_HEART_HOME or ~/.laya-heart.
// No API keys are stored: the optional remote backends name an environment variable instead
// ("env:NAME"), so nothing secret ever sits in a file or reaches the page.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function homeDir(env = process.env) {
  return path.resolve(env.LAYA_HEART_HOME || path.join(os.homedir(), ".laya-heart"));
}

export const DEFAULTS = {
  lang: "zh",
  consentAccepted: false,
  stage: "dating", // before people (memory/people.js): copied into the first person, "TA"
  background: "", // the same; moved into TA's core card and cleared
  currentPerson: "", // the person whose chat the page opens
  autoMemory: true, // keep what matters from the chat in each person's memory (memory/learn.js); local models only
  judge: {
    backend: "laya-local", // laya-local | http
    modelDir: "", // empty = models/laya-multilingual-onnx in the app folder
    numThreads: 0,
    httpBase: "http://127.0.0.1:8000",
    httpModel: "laya-heart",
    httpKeyEnv: "",
  },
  draft: {
    backend: "auto", // auto (llama-server if found, else Ollama) | llama-server | ollama | openai
    model: "gemma4:e2b", // the default: the GGUF the first start downloads; else an Ollama model name, whose GGUF llama-server reads
    gguf: "", // path to a GGUF file of one's own (optional; then only this file is used)
    llamaServer: "", // path to another llama-server build (optional)
    numThreads: 0,
    ollamaBase: "http://127.0.0.1:11434",
    keepAlive: "30m",
    openaiBase: "",
    openaiModel: "",
    openaiKeyEnv: "",
  },
  thresholds: { uncertain: 0.45, safetyModel: 0.8 },
};

const STAGES = ["just_met", "talking", "dating", "partner", "ex"];
const BACKENDS = { judge: ["laya-local", "http"], draft: ["auto", "llama-server", "ollama", "openai"] };

function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in base)) continue; // unknown keys are dropped, so the file only holds what we know
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object"
      ? merge(base[k], v) : v;
  }
  return out;
}

/** Keep values in range, whatever the page or an old file sent. */
export function sanitize(s) {
  const out = merge(DEFAULTS, s);
  out.lang = out.lang === "en" ? "en" : "zh";
  out.consentAccepted = !!out.consentAccepted;
  out.autoMemory = out.autoMemory !== false;
  out.stage = STAGES.includes(out.stage) ? out.stage : DEFAULTS.stage;
  out.background = String(out.background || "").slice(0, 200);
  out.currentPerson = /^[a-z0-9]{10}$/.test(String(out.currentPerson)) ? out.currentPerson : "";
  for (const part of ["judge", "draft"]) {
    if (!BACKENDS[part].includes(out[part].backend)) out[part].backend = DEFAULTS[part].backend;
    out[part].numThreads = Math.max(0, Math.min(32, Math.trunc(Number(out[part].numThreads) || 0)));
    for (const [k, v] of Object.entries(out[part])) if (typeof DEFAULTS[part][k] === "string") out[part][k] = String(v ?? "").slice(0, 400);
  }
  for (const k of ["uncertain", "safetyModel"]) {
    const v = Number(out.thresholds[k]);
    out.thresholds[k] = Number.isFinite(v) && v > 0 && v < 1 ? v : DEFAULTS.thresholds[k];
  }
  return out;
}

export class SettingsStore {
  constructor(dir = homeDir()) {
    this.dir = dir;
    this.file = path.join(dir, "settings.json");
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { /* first run */ }
    this.data = sanitize(raw);
  }

  get() {
    return structuredClone(this.data);
  }

  update(patch) {
    this.data = sanitize(merge(this.data, patch || {}));
    this.save();
    return this.get();
  }

  /** "env:NAME" (or just NAME) -> that environment variable; anything else -> "". */
  static secret(ref, env = process.env) {
    const name = String(ref || "").replace(/^env:/, "").trim();
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? env[name] || "" : "";
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
