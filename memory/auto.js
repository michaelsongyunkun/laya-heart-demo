// Keeping what matters from the chat, without being asked (docs/design/spec-auto-memory.md).
// Rules first: only lines about days, likes, plans and promises, the people around them, big
// events or sore points go on (most chat costs nothing). Gemma then picks what is worth keeping
// from those and gives each a few-word label; what is kept is the line's own words, checked to be
// really in the chat, with a relative day ("下周六") turned into a date by the code. A 2B model
// rewriting what was said gets the subject wrong or drops a "not"; quoting it does not.
import { LAYERS, findDate } from "./book.js";
import { terms } from "./retrieve.js";

export const AUTO_MAX = 300; // kept per person
export const PICK_MAX = 3; // kept per run
export const PICK_LINES = 12; // lines Gemma reads per run, the newest
export const QUOTE_MAX = 40;
export const LABEL_MAX = 12;
export const AUTO_SECTION = "自动记下的";
export const AUTO_WEIGHT = 0.9; // what you wrote yourself comes first

const KEEP = [
  /生日|纪念日|周年|在一起|第一次|结婚|领证|求婚/, // days that matter
  /(?<!\d)\d{1,2}\s*[月号日]|明天|明晚|后天|今晚有|下(?:下)?个?(?:周|星期|礼拜)|这个?(?:周|星期|礼拜)|周[一二三四五六日天末]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|月底|过年|春节|中秋|国庆|情人节|七夕|圣诞/, // days to come
  /喜欢(?!你)|讨厌(?!你)|爱吃|不吃|不能吃|忌口|过敏|最爱(?!你)|受不了|害怕/, // likes, dislikes, allergies ("喜欢你" is affection, not a fact)
  /答应|说好|约好|约了|保证|一起去|陪我|别忘|记得|下次/, // plans and promises
  /我(?:妈|爸|姐|哥|弟|妹|奶奶|爷爷|外婆|外公|闺蜜|室友|同事|老板|朋友|家猫|家狗)|妈妈|爸爸|闺蜜|室友/, // people around them
  /工作|面试|考试|考研|毕业|搬家|生病|住院|手术|出差|旅行|辞职|升职|失业|签证|论文|实习/, // big events
  /别再|不要再|再也不|受够|雷区|不许/, // sore points
  /birthday|anniversary|allerg|\bi (?:love|hate|like|can't stand)\b(?! you\b)|promise|next (?:week|mon|tue|wed|thu|fri|sat|sun)|tomorrow|\bmy (?:mom|dad|mother|father|sister|brother|best friend)\b|interview|exam\b/i,
];

/** Could this line hold something worth keeping? Generous: Gemma decides. */
export function isCandidate(text) {
  const s = String(text || "").trim();
  return s.length >= 4 && KEEP.some((re) => re.test(s));
}

// ---------------- days ----------------
const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }; // Monday first
const ymd = (dt) => ({ y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() });
const dayAt = (base, n) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
const weekday = (dt) => (dt.getDay() === 0 ? 7 : dt.getDay());
const pad = (n) => String(n).padStart(2, "0");
export const dateText = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;

/** The first day named in a text, from when it was said: {date, index, length, relative} or null. */
function dateMatch(s, base) {
  let m = /(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})\s*[日号]?/.exec(s);
  if (m) {
    const date = findDate(m[0]);
    return date ? { date, index: m.index, length: m[0].length, relative: false } : null;
  }
  m = /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(s);
  if (m) {
    let y = base.getFullYear();
    // Said at the end of December about "1月2号": next year (more than a month back means next time round).
    if (new Date(y, +m[1] - 1, +m[2]) < dayAt(base, -30)) y += 1;
    return { date: { y, m: +m[1], d: +m[2] }, index: m.index, length: m[0].length, relative: false };
  }
  const words = [[/大后天/, 3], [/后天/, 2], [/明天|明晚|明早|tomorrow/i, 1], [/今天|今晚|today|tonight/i, 0]];
  for (const [re, n] of words) {
    m = re.exec(s);
    if (m) return { date: ymd(dayAt(base, n)), index: m.index, length: m[0].length, relative: true };
  }
  const monday = dayAt(base, 1 - weekday(base));
  m = /(下下|下|这|本|上)?\s*个?\s*(?:周|星期|礼拜)\s*([一二三四五六日天末])/.exec(s);
  if (m) {
    const week = { 下下: 14, 下: 7, 上: -7, 这: 0, 本: 0 }[m[1]] ?? null;
    const target = m[2] === "末" ? 6 : WEEKDAY[m[2]];
    let dt;
    if (week != null) dt = dayAt(monday, week + target - 1);
    else if (m[2] === "末" && weekday(base) >= 6) dt = base; // "周末" said at the weekend: this one
    else dt = dayAt(base, (target - weekday(base) + 7) % 7); // the coming one, today included
    return { date: ymd(dt), index: m.index, length: m[0].length, relative: true };
  }
  m = /(?<![\d月])(\d{1,2})\s*[号日](?![子期])/.exec(s) || /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/i.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    const d = +m[1];
    const dt = d >= base.getDate() ? new Date(base.getFullYear(), base.getMonth(), d) : new Date(base.getFullYear(), base.getMonth() + 1, d);
    return { date: ymd(dt), index: m.index, length: m[0].length, relative: true };
  }
  return null;
}

/** The day a line names, counted from `at` (when it was said), or null. */
export function resolveDate(text, at = Date.now()) {
  return dateMatch(String(text || ""), new Date(at))?.date ?? null;
}

/** The words as said, a relative day followed by its date: "下周六（10-24）是我生日". */
export function withDate(text, at = Date.now()) {
  const s = String(text || "");
  const hit = dateMatch(s, new Date(at));
  if (!hit) return { text: s, date: null };
  if (!hit.relative) return { text: s, date: hit.date };
  const end = hit.index + hit.length;
  return { text: `${s.slice(0, end)}（${pad(hit.date.m)}-${pad(hit.date.d)}）${s.slice(end)}`, date: hit.date };
}

// ---------------- what Gemma reads and writes ----------------
// Identical for every run: llama-server keeps it once read.
export const PICK_SYSTEM = [
  "你帮「我」从和伴侣「TA」的聊天里，挑出以后值得记住的话。",
  "值得记：日子（生日、纪念日、约好的日期）、TA 的喜好和忌口（包括过敏）、约定和承诺、TA 身边的人、TA 的大事、TA 讨厌或很在意的事。",
  "不值得记：寒暄、情绪、表白和撒娇（比如「喜欢你」）、问句、马上就过去的小事。",
  "每条一行，格式：标签｜原话",
  "- 标签：几个字说清是什么事，要具体，比如「生日」「芒果过敏」「妈妈周末来吃饭」，不要只写「日子」「约定」这种类别。",
  "- 原话：从聊天里照抄最关键的一小段，一字不改。",
  `最多 ${PICK_MAX} 条。没有值得记的，只输出：无`,
].join("\n");

/** The lines for one run: each candidate with the line before it, the newest PICK_LINES in all. */
export function pickLines(thread, candidateIdx, { max = PICK_LINES } = {}) {
  const want = new Set();
  for (const i of [...candidateIdx].sort((a, b) => b - a)) {
    if (want.size >= max) break;
    want.add(i);
    if (i > 0 && want.size < max) want.add(i - 1);
  }
  return [...want].sort((a, b) => a - b).map((i) => ({ from: thread[i].from, text: String(thread[i].text).slice(0, 120), msg: thread[i] }));
}

export function pickMessages(lines) {
  return [
    { role: "system", content: PICK_SYSTEM },
    { role: "user", content: ["聊天：", ...lines.map((l) => `${l.from === "partner" ? "TA" : "我"}：${l.text}`), "", "值得记住的："].join("\n") },
  ];
}

const NEG = "不没别未非无";
// A kind of thing, not what it is: the words say more on their own.
const GENERIC_LABEL = /^(?:日子|日期|约定|承诺|约定和承诺|喜好|忌口|喜好和忌口|大事|身边的人|雷区|事情|事|记住|重要的事|值得记)$/;
const squeeze = (s) => String(s).replace(/\s+/g, "");
const unquote = (s) => String(s).trim().replace(/^[「『“"'《]+|[」』”"'》]+$/g, "").trim();

/** Does the label say what the words say? Not when it drops a "not" before them, or adds one. */
function labelFits(label, quote) {
  const labelNeg = [...label].some((c) => NEG.includes(c));
  let found = false;
  let negBefore = false;
  for (const piece of terms(label)) {
    const i = quote.indexOf(piece);
    if (i < 0) continue;
    found = true;
    if (i > 0 && NEG.includes(quote[i - 1]) && !label.includes(quote[i - 1])) negBefore = true;
  }
  if (labelNeg && ![...quote].some((c) => NEG.includes(c))) return false;
  return !(found && negBefore && !labelNeg);
}

/**
 * Gemma's "标签｜原话" lines, kept only when the words are in one of `lines` (then they are that
 * line's, with its speaker and message). @returns {{label, quote, from, msg}[]}
 */
export function parsePicks(text, lines, { max = PICK_MAX } = {}) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const s = raw.trim().replace(/^(?:[-*•·]|\d+\s*[.、)）])\s*/, "");
    const m = /^(.{1,24}?)\s*[｜|]\s*(.+)$/.exec(s);
    if (!m) continue;
    let label = unquote(m[1].replace(/^标签\s*[:：]\s*/, ""));
    let quote = unquote(unquote(m[2].replace(/^原话\s*[:：]\s*/, "")).replace(/^(?:TA|我|对方)\s*[:：]\s*/, ""));
    quote = quote.replace(/[。.!！?？，,、]+$/, "");
    if (squeeze(quote).length < 2) continue;
    const src = lines.find((l) => squeeze(l.text).includes(squeeze(quote)));
    if (!src) continue;
    if (!src.text.includes(quote)) quote = squeeze(quote);
    if (quote.length > QUOTE_MAX) quote = `${quote.slice(0, QUOTE_MAX - 1)}…`;
    label = label.slice(0, LABEL_MAX);
    if (GENERIC_LABEL.test(label) || (label && !labelFits(label, quote))) label = "";
    out.push({ label, quote, from: src.from, msg: src.msg });
    if (out.length >= max) break;
  }
  return out;
}

/** How much of the shorter text's pieces the longer one has (0..1). */
export function overlap(a, b) {
  const A = new Set(terms(a));
  const B = new Set(terms(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

/** Already kept: the same words, or nearly (3 in 4 pieces of the shorter one). */
export function isDuplicate(pick, kept) {
  return kept.some((k) => overlap(pick.quote, k.quote) >= 0.75);
}

/** A kept memory as a chunk of the person's memory: with a day it is an event (the day rule sees it). */
export function autoChunk(mem) {
  const dated = !!mem.date?.d;
  return {
    id: mem.id,
    layer: dated ? LAYERS.EVENTS : LAYERS.FACTS,
    section: AUTO_SECTION,
    title: [dated ? dateText(mem.date) : "", mem.label].filter(Boolean).join(" "),
    text: `${mem.from === "partner" ? "TA" : "我"}：${mem.text}`,
    date: mem.date ?? null,
    source: "auto",
    weight: AUTO_WEIGHT,
  };
}
