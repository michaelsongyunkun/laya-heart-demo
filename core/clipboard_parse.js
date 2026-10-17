// Turns copied chat text into messages. The common case is one line the partner sent; we also
// accept "speaker: text" transcripts so a whole exchange can be pasted at once.
// Nothing here reads the clipboard: the web page gets the text from the user's own Ctrl+V.

const ME = /^(?:我|me|i|自己)$/i;
const PARTNER = /^(?:对方|ta|他|她|伴侣|partner|them|him|her)$/i;
const SPEAKER_LINE = /^\s*([^:：\n]{1,16})\s*[:：]\s*(.+)$/;
// WeChat-style header line: "名字 10:21" or "名字 2026/10/13 10:21:05"
const HEADER_LINE = /^\s*(\S{1,16})\s+(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*$/;

function speakerOf(name, myName) {
  const n = name.trim();
  if (ME.test(n) || (myName && n === myName)) return "me";
  if (PARTNER.test(n)) return "partner";
  return null;
}

/**
 * @param {string} text
 * @param {{myName?: string}} [opts]
 * @returns {{from: "partner"|"me", text: string}[]}
 */
export function parseChatText(text, opts = {}) {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return [];
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  // "我: …" / "对方: …" transcript (every line must parse, else treat as one message)
  const parsed = lines.map((l) => {
    const m = l.match(SPEAKER_LINE);
    if (!m) return null;
    const who = speakerOf(m[1], opts.myName);
    return who ? { from: who, text: m[2].trim() } : null;
  });
  if (lines.length > 1 && parsed.every(Boolean)) return parsed;

  // WeChat-style "name time" headers followed by content lines.
  if (lines.some((l) => HEADER_LINE.test(l))) {
    const out = [];
    let who = "partner";
    for (const l of lines) {
      const h = l.match(HEADER_LINE);
      if (h) {
        who = speakerOf(h[1], opts.myName) || (h[1] === opts.myName ? "me" : "partner");
        continue;
      }
      const last = out[out.length - 1];
      if (last && last.from === who && last.open) last.text += "\n" + l;
      else out.push({ from: who, text: l, open: true });
    }
    return out.map(({ from, text: t }) => ({ from, text: t }));
  }

  // Default: everything the user copied is one message from the partner.
  return [{ from: "partner", text: lines.join("\n") }];
}
