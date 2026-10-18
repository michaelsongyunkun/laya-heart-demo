// Runtime checks on each draft — plain code rules, no model call.
// The checklist (new promises, promising for others, made-up facts) runs as cheap rules so
// the panel stays fast. Model-graded checks belong to the offline benchmark, not to the
// runtime path.

export const LIMITS = { maxChars: 60 };

const TIME_WORDS = /今晚|今天晚上|明天|后天|大后天|下周[一二三四五六日天]?|周[一二三四五六日天末]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|\d{1,2}\s*[点:：]\s*(?:\d{1,2}|半)?|\d{1,2}\s*号|\d{1,2}\s*月/g;
const NUMBERS = /\d+(?:\.\d+)?/g;
const PROMISE = /保证|发誓|一定会|再也不(?:会)?|以后(?:都|每天|一定)|永远(?:不|都)|i promise|i swear|never again/i;
const HOSTILE = /随便你|爱咋咋地|你有病|神经病|滚|闭嘴|分手就分手|你自己看着办|无理取闹|至于吗|你想多了|矫情|作死|whatever|shut up|you'?re crazy/i;
const CLAIMS_DONE = /我(?:已经)?订(?:好)?了|已经(?:订|买|约|安排|处理)好?了|我买好了/;

function unseen(regex, draft, chat) {
  const found = draft.match(regex) || [];
  return [...new Set(found.map((s) => s.replace(/\s+/g, "")))].filter((s) => !chat.replace(/\s+/g, "").includes(s));
}

/**
 * @param {string} draft
 * @param {{chat: string, latest: string, bestAction?: string, heat?: number}} ctx
 * @returns {{flags: {code: string, detail?: string}[], penalty: number}}
 */
export function checkCandidate(draft, ctx) {
  const flags = [];
  let penalty = 0;
  const text = String(draft || "");
  const len = [...text].length;

  if (len > LIMITS.maxChars) {
    flags.push({ code: "too_long", detail: String(len) });
    penalty += 0.15;
  }
  const newTimes = unseen(TIME_WORDS, text, ctx.chat);
  const newNums = unseen(NUMBERS, text, ctx.chat).filter((n) => !newTimes.some((t) => t.includes(n)));
  if (newTimes.length || newNums.length) {
    flags.push({ code: "new_fact", detail: [...newTimes, ...newNums].join(" ") });
    penalty += 0.25;
  }
  if (CLAIMS_DONE.test(text) && !CLAIMS_DONE.test(ctx.chat)) {
    flags.push({ code: "claims_done" });
    penalty += 0.2;
  }
  if (PROMISE.test(text) && ctx.bestAction !== "commit") {
    flags.push({ code: "promise" });
    penalty += 0.1;
  }
  if (HOSTILE.test(text)) {
    // Larger than any Laya probability: a hurtful line always sinks to the bottom.
    flags.push({ code: "hostile" });
    penalty += 1.0;
  }
  if ((ctx.heat ?? 0) >= 5 && [...text.replace(/[\s。.!！?？…~～]/g, "")].length <= 4) {
    flags.push({ code: "too_curt" });
    penalty += 0.3;
  }
  if (ctx.latest && text.replace(/\s/g, "") === ctx.latest.replace(/\s/g, "")) {
    flags.push({ code: "echo" });
    penalty += 0.3;
  }
  return { flags, penalty };
}
