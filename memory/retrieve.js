// Finding what in a person's memory bears on what they just said (docs/design/spec-people-memory.md).
// Lexical, for now: Chinese is cut into overlapping two-character pieces, words and numbers stay
// whole, BM25 ranks the chunks and each layer has a weight. A chunk counts only when at least two
// different pieces of what they said are in it, so most turns bring nothing: every chunk handed
// to Gemma is read again on each turn it is used (~20 ms a token on a laptop CPU).
import { LAYERS, chunkLabel } from "./book.js";

// minDocs: how rare a piece is (idf) is counted as if there were at least this many chunks. A new
// person has one or two (a kept birthday, an empty book), and no piece of those was ever rare
// enough to pass minScore. From five chunks up (the sample book) nothing changes.
export const RETRIEVE = { k1: 1.2, b: 0.75, minHits: 2, minScore: 1.5, maxChunks: 2, maxChars: 140, minDocs: 5 };
// Of a chunk found, Gemma reads at most this many characters: the sentences that bear on what
// they said (focusText). A whole chunk cost ~45-66 tokens, 1.3-1.7 s more to the first reply.
export const NOTE_MAX = 50;
export const LAYER_WEIGHT = { [LAYERS.EVENTS]: 1.3, [LAYERS.FACTS]: 1.0, [LAYERS.CHAT]: 0.8 };
// Pieces so common in chat that they say nothing about what a chat is about.
const STOP = new Set([
  "我们", "你们", "他们", "她们", "什么", "怎么", "这个", "那个", "一个", "没有", "就是", "可以", "知道", "不是",
  "还是", "但是", "因为", "所以", "自己", "现在", "已经", "时候", "一下", "真的", "觉得", "你的", "我的", "他的",
  "她的", "了吗", "的话", "然后", "这样", "那样", "一点", "有点", "不要", "不会", "我是", "你是", "了吧", "今天",
]);
// They expect me to remember something: judge/select.js MEMORY (which picks the card's memory
// question), plus the English words.
const REMEMBER = /忘|记得|记不记得|说过|答应过|什么日子|纪念日|生日|remember|anniversary|birthday/i;
// ... and it is a day they ask about ("你还记得我们第一次吵架吗" is about the fight, not today).
const DAY_ASK = /什么日子|纪念日|几号|哪天|生日|anniversary|what day|birthday/i;
// ... or, when nothing in the book matches, something vaguer, unless they mean words said.
const SAID = /说过|说的|答应|said|promise/i;
const DAY = 86400000;

export function terms(text) {
  const out = [];
  for (const [w] of String(text || "").toLowerCase().matchAll(/\p{Script=Han}+|[a-z0-9]+/gu)) {
    if (/^[a-z0-9]+$/.test(w)) {
      if (w.length > 1 || /\d/.test(w)) out.push(w);
    } else {
      for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2));
    }
  }
  return out;
}

export function buildIndex(chunks) {
  const docs = (chunks || []).map((chunk) => {
    const ts = terms(`${chunk.title || ""}\n${chunk.text}`);
    const tf = new Map();
    for (const t of ts) tf.set(t, (tf.get(t) || 0) + 1);
    return { chunk, tf, len: ts.length };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avgLen = docs.reduce((n, d) => n + d.len, 0) / (docs.length || 1);
  return { docs, df, avgLen, n: docs.length };
}

// Their newest turn: the partner lines at the end of the chat (any lines of mine after it aside).
function lastTurn(thread) {
  const msgs = (thread || []).filter((m) => m && String(m.text || "").trim());
  let end = msgs.length - 1;
  while (end >= 0 && msgs[end].from !== "partner") end--;
  let start = end;
  while (start > 0 && msgs[start - 1].from === "partner") start--;
  return { msgs, start, end };
}

/** Their newest turn, as text: what they ask of me (the day rule listens to this alone). */
export function partnerTurn(thread) {
  const { msgs, start, end } = lastTurn(thread);
  return end < 0 ? "" : msgs.slice(start, end + 1).map((m) => m.text).join("\n");
}

/** What to search with: their newest turn and the line before it. */
export function queryText(thread) {
  const { msgs, start, end } = lastTurn(thread);
  return end < 0 ? "" : msgs.slice(Math.max(0, start - 1), end + 1).map((m) => m.text).join("\n");
}

// Days between today and the nearest time this month-day comes round (last year, this year or next).
function daysApart({ m, d }, now) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let best = Infinity;
  for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    best = Math.min(best, Math.abs(Date.UTC(y, m - 1, d) - today) / DAY);
  }
  return best;
}

/**
 * The part of a chunk that bears on what they said: its sentences (chat lines, for past chat)
 * that share a piece with it, in order, or the first ones if none does; within NOTE_MAX characters.
 */
export function focusText(chunk, query) {
  const q = new Set(terms(query).filter((t) => !STOP.has(t)));
  const chat = chunk.layer === LAYERS.CHAT;
  const parts = (chat ? chunk.text.split("\n") : chunk.text.split(/(?<=[。！？!?；;])|\n/))
    .map((s) => s.trim()).filter(Boolean);
  const hits = parts.filter((s) => terms(s).some((t) => q.has(t)));
  const sep = chat ? " / " : "";
  let text = "";
  for (const s of hits.length ? hits : parts) {
    if (text && text.length + sep.length + s.length > NOTE_MAX) break;
    text += (text ? sep : "") + s;
  }
  return text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX - 1)}…` : text;
}

/** One line of "我记得的事" for Gemma: the chunk's title (an event, a chat's date), then its focused text. */
export function noteFor(chunk, query) {
  const text = focusText(chunk, query);
  return chunk.title ? `【${chunk.title}】${text}` : text;
}

/**
 * @param {{now?: Date, asked?: string}} [opts] asked: their newest turn (partnerTurn), for the day
 *   rule; defaults to the query
 * @returns {{chunk: object, score: number, hits: number}[]} at most maxChunks, best first
 */
export function retrieve(index, query, { now = new Date(), asked = query, ...opts } = {}) {
  const o = { ...RETRIEVE, ...opts };
  const q = [...new Set(terms(query).filter((t) => !STOP.has(t)))];
  const scored = [];
  if (q.length && index?.n) {
    const n = Math.max(index.n, o.minDocs);
    for (const d of index.docs) {
      let score = 0;
      let hits = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        hits++;
        const df = index.df.get(t);
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * f * (o.k1 + 1)) / (f + o.k1 * (1 - o.b + (o.b * d.len) / index.avgLen));
      }
      if (hits < o.minHits) continue;
      score *= (LAYER_WEIGHT[d.chunk.layer] ?? 1) * (d.chunk.weight ?? 1); // weight: what was kept from the chat, a little less
      if (score >= o.minScore) scored.push({ chunk: d.chunk, score, hits });
    }
  }
  // "Do you remember what day it is?" within 3 days of a day in the book: that day comes first.
  // A vaguer "did you forget something?" counts too, unless the book matched something else or
  // they mean words said ("你是不是又把我说过的话忘了").
  if (index?.n && REMEMBER.test(asked) && (DAY_ASK.test(asked) || (!scored.length && !SAID.test(asked)))) {
    for (const d of index.docs) {
      const c = d.chunk;
      if (c.layer !== LAYERS.EVENTS || !c.date?.d || daysApart(c.date, now) > 3) continue;
      const had = scored.find((s) => s.chunk.id === c.id);
      if (had) had.score += 100;
      else scored.push({ chunk: c, score: 100, hits: 0 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const groups = new Set();
  let chars = 0;
  for (const s of scored) {
    const group = `${s.chunk.section}|${s.chunk.title}`;
    if (groups.has(group)) continue;
    const len = chunkLabel(s.chunk).length;
    if (picked.length && chars + len > o.maxChars) continue;
    picked.push(s);
    groups.add(group);
    chars += len;
    if (picked.length >= o.maxChunks) break;
  }
  return picked;
}
