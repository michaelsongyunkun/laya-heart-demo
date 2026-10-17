// Splits a model reply into candidate lines. Small models label, number and quote their
// lines even when told not to (the same lesson as jev-chat-jarvis-mac generate.py), so we
// strip that before the lines are shown or checked.

const NUMBERING = /^\s*(?:[-*•·]|\(?\d{1,2}[.)、:：]|[①②③④⑤]|第[一二三四五1-5]条[:：]?)\s*/;
const LABEL = /^\s*(?:\*\*)?(?:回复|候选|草稿|选项|稳妥|温暖|简短|版本|reply|option|candidate)\s*[A-Ca-c1-5一二三]?\s*(?:\*\*)?\s*[:：]\s*/i;
const QUOTES = /^["“”「『'‘]+|["”」』'’]+$/g;
// Preambles ("好的，给你 3 条回复：", "以下是…", "Here are…"). A reply may itself start with
// 好的, so only lines that talk about the replies count as preamble.
export function isPreamble(s) {
  return /[:：]$/.test(s)
    || /^(?:以下|下面|这里)是/.test(s)
    || /^(?:好的|当然|没问题|可以)[，,！!。\s]*.{0,14}(?:回复|候选|草稿|几条|三条|\d\s*条)/.test(s)
    || /^(?:here are|here's|sure[,!]?\s+here)/i.test(s);
}

export function cleanLine(line) {
  let s = String(line || "").trim();
  if (!s) return "";
  s = s.replace(/\*\*/g, "");
  s = s.replace(NUMBERING, "");
  s = s.replace(LABEL, "");
  s = s.replace(QUOTES, "").trim();
  s = s.replace(NUMBERING, "").replace(QUOTES, "").trim();
  return s;
}

/** Candidates whose line is finished (followed by a newline), while the text is still streaming. */
export function finishedCandidates(text, max = 3) {
  const s = String(text || "");
  const end = s.lastIndexOf("\n");
  return end < 0 ? [] : parseCandidates(s.slice(0, end), max);
}

/** Complete candidate lines from the full text (dedup, drop preambles). */
export function parseCandidates(text, max = 3) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const s = cleanLine(raw);
    if (!s || isPreamble(s)) continue;
    if (out.some((x) => x === s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
