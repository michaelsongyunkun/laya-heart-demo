// The book you write about one person, cut into a layered memory (docs/design/spec-people-memory.md):
//   "# 速览"        L0, the core card: always handed to Gemma, never searched
//   "# 重要的事"    L1, dated events, promises, fights and how they ended: searched; dates count
//   any other "#"   L2, everything else you know about them: searched
// Each "## title" inside a section starts a group, and every chunk carries its group's title,
// so a chunk still makes sense on its own. Chunks end at sentence ends, never inside a sentence
// unless one sentence alone is over the limit. The book itself is kept exactly as written.
// The older chat becomes L3 chunks (chatChunks); the newest lines are in the prompt already.
import crypto from "node:crypto";

export const LAYERS = { CORE: 0, EVENTS: 1, FACTS: 2, CHAT: 3 };
export const BOOK_MAX = 50000;
// L0 characters for Gemma. They sit in the prompt's fixed part, so they are read once, but every
// turn then reads and writes with them in its context: measured on a laptop CPU (2026-10-14),
// 78 characters made reading new lines 9% and writing 5% slower (~0.3 s a turn), 300 made it 21%
// and 9% (~0.75 s). The template's four lines filled in come to about 80.
export const CORE_MAX = 120;
export const CHUNK_MAX = 160;
export const CHUNK_MIN = 40; // a chunk shorter than this takes in the next paragraph
export const HARD_OVERLAP = 20;
export const RECENT_UNSEARCHED = 24; // newest chat lines: already in Gemma's window, not searched
const CHAT_CHUNK = { lines: 6, chars: 200 };

const CORE_TITLE = /速览|档案|概要|基本|at a glance|profile|summary/i;
const EVENTS_TITLE = /重要|大事|纪念|事件|承诺|吵架|回忆|matter|important|event|memor/i;
// Template hints left as they were, and labels with nothing after them, are not memories.
const PLACEHOLDER = /^[（(][^）)]*[）)]$/;
const EMPTY_LABEL = /^[^：:\n]{1,12}[：:]\s*$/;

export const BOOK_TEMPLATE = {
  zh: [
    "# 速览", "称呼：", "关系：", "雷区：", "喜好：", "",
    "# 重要的事", "## 2025-10-14 在一起的那天", "（写发生了什么、TA 当时的反应）", "",
    "# 了解 TA", "（习惯、家人朋友、工作学习、最近在忙什么……）", "",
  ].join("\n"),
  en: [
    "# At a glance", "Call them:", "Relationship:", "Avoid:", "Likes:", "",
    "# Things that mattered", "## 2025-10-14 The day we got together", "(what happened, how they reacted)", "",
    "# Knowing them", "(habits, family and friends, work or study, what keeps them busy lately)", "",
  ].join("\n"),
};

export function layerOf(title) {
  if (CORE_TITLE.test(title)) return LAYERS.CORE;
  if (EVENTS_TITLE.test(title)) return LAYERS.EVENTS;
  return LAYERS.FACTS;
}

function validDate(y, m, d) {
  if (!(m >= 1 && m <= 12) || (d != null && !(d >= 1 && d <= 31))) return null;
  return { y, m, d };
}

/** The first date in a text: 2026-02-14, 2026.2.14, 2026年2月14日, 2月14日, or a month (2026-02). */
export function findDate(text) {
  const s = String(text || "");
  let m = /(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})(?!\d)/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(s);
  if (m) return validDate(null, +m[1], +m[2]);
  m = /(\d{4})\s*[-./年]\s*(\d{1,2})(?!\d)/.exec(s);
  if (m) return validDate(+m[1], +m[2], null);
  return null;
}

export function chunkId(layer, section, title, text) {
  return crypto.createHash("sha1").update(`${layer}|${section}|${title}|${text}`).digest("hex").slice(0, 10);
}

/** How a chunk is shown to Gemma and on the page: where it sits in the book, then its text. */
export function chunkLabel(c) {
  const where = [c.section, c.title].filter(Boolean).join(" · ");
  return where ? `【${where}】${c.text}` : c.text;
}

// A paragraph as sentences; `nl` marks one that began a new line in the original.
function sentences(par) {
  const out = [];
  par.split("\n").forEach((line, li) => {
    line.split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean)
      .forEach((s, si) => out.push({ s, nl: li > 0 && si === 0 }));
  });
  return out;
}

// One sentence over the limit: cut it, overlapping a little so no phrase is lost at a cut.
function hardSplit(s) {
  const out = [];
  for (let i = 0; ; i += CHUNK_MAX - HARD_OVERLAP) {
    out.push(s.slice(i, i + CHUNK_MAX));
    if (i + CHUNK_MAX >= s.length) return out;
  }
}

function splitLong(par) {
  const out = [];
  let cur = "";
  for (const { s, nl } of sentences(par)) {
    if (s.length > CHUNK_MAX) {
      if (cur) out.push(cur);
      cur = "";
      out.push(...hardSplit(s));
      continue;
    }
    const sep = cur && nl ? "\n" : "";
    if (cur && cur.length + sep.length + s.length > CHUNK_MAX) {
      out.push(cur);
      cur = s;
      continue;
    }
    cur += sep + s;
  }
  if (cur) out.push(cur);
  return out;
}

/** A group's paragraphs as chunks: a short chunk takes in the next paragraph, a long one is split. */
export function packParagraphs(paras) {
  const out = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > CHUNK_MAX) {
      if (cur) out.push(cur);
      cur = "";
      out.push(...splitLong(p));
      continue;
    }
    if (cur && cur.length < CHUNK_MIN && cur.length + 1 + p.length <= CHUNK_MAX) {
      cur += `\n${p}`;
      continue;
    }
    if (cur) out.push(cur);
    cur = p;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * @returns {{core: string, coreTooLong: boolean,
 *   chunks: {id: string, layer: number, section: string, title: string, text: string,
 *     date: {y: number|null, m: number, d: number|null}|null, source: "book"}[],
 *   sections: {title: string, layer: number}[]}}
 */
export function parseBook(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n").slice(0, BOOK_MAX);
  const sections = [];
  let sec = null;
  let grp = null;
  const openSection = (title) => {
    sec = { title, layer: layerOf(title), groups: [] };
    sections.push(sec);
    grp = null;
  };
  const openGroup = (title) => {
    if (!sec) openSection("");
    grp = { title, lines: [] };
    sec.groups.push(grp);
  };
  for (const raw of src.split("\n")) {
    const line = raw.trimEnd();
    const head = /^(#{1,6})\s+(.+)$/.exec(line);
    if (head?.[1].length === 1) openSection(head[2].trim());
    else if (head) openGroup(head[2].trim());
    else {
      if (!grp) openGroup("");
      grp.lines.push(line);
    }
  }
  const paragraphs = (lines) => lines.join("\n").split(/\n\s*\n/).map((p) => p.trim())
    .filter((p) => p && !PLACEHOLDER.test(p));

  const coreLines = [];
  const chunks = [];
  for (const s of sections) {
    for (const g of s.groups) {
      const paras = paragraphs(g.lines);
      if (s.layer === LAYERS.CORE) {
        if (g.title && paras.length) coreLines.push(g.title);
        for (const p of paras) coreLines.push(...p.split("\n").map((l) => l.trim()).filter((l) => l && !EMPTY_LABEL.test(l)));
        continue;
      }
      const groupDate = findDate(g.title);
      for (const t of packParagraphs(paras)) {
        chunks.push({ id: chunkId(s.layer, s.title, g.title, t), layer: s.layer, section: s.title, title: g.title, text: t,
          date: groupDate || findDate(t), source: "book" });
      }
    }
  }
  const coreAll = coreLines.join("\n");
  const core = coreAll.slice(0, CORE_MAX);
  return {
    core,
    coreTooLong: coreAll.length > CORE_MAX,
    chunks,
    sections: sections.map((s) => ({ title: s.title, layer: s.layer })),
  };
}

const pad = (n) => String(n).padStart(2, "0");

/** The chat older than the newest RECENT_UNSEARCHED lines, as L3 chunks of up to 6 lines / 200 characters. */
export function chatChunks(thread, { recent = RECENT_UNSEARCHED } = {}) {
  const all = thread || [];
  const old = all.slice(0, Math.max(0, all.length - recent));
  const out = [];
  let cur = [];
  let chars = 0;
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((m) => `${m.from === "partner" ? "对方" : "我"}：${m.text}`).join("\n").slice(0, CHAT_CHUNK.chars);
    const at = Number.isFinite(cur[0].at) ? new Date(cur[0].at) : null;
    const title = at ? `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` : "";
    out.push({ id: chunkId(LAYERS.CHAT, "聊天", title, text), layer: LAYERS.CHAT, section: "聊天", title, text,
      date: at ? { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate() } : null, source: "chat" });
    cur = [];
    chars = 0;
  };
  for (const m of old) {
    const len = String(m.text || "").length + 3;
    if (cur.length && (cur.length >= CHAT_CHUNK.lines || chars + len > CHAT_CHUNK.chars)) flush();
    cur.push(m);
    chars += len;
  }
  flush();
  return out;
}
