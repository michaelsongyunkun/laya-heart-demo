// Question bank for the per-message cards (2026-10-13). Instead of the same 7 long questions on
// every press, each partner turn gets 1–3 short questions picked by judge/select.js, worded
// around what was just said ("“你最好是”代表相信你了吗？"), plus one hidden safety question.
//
// Short on purpose: Laya reads "question + options + chat" once per question, so the question
// text is most of its work (see .local/speed). Option descriptions are one short line each;
// the panel shows the zh/en labels, Laya reads `desc`. The fine-tuned Laya the app downloads (v3)
// learned from practice chats labelled against this bank and its wording: changing them needs a new run.
// Pure module: the panel UI imports it too.

export const BANK_VERSION = "cards-v1-2026-10-13";

// Quotes longer than this are left out of the question and the generic wording is used.
export const MAX_QUOTE_CHARS = 10;

const yes = (zh, en, desc) => ({ zh, en, desc });

export const BANK = {
  literal: {
    type: "choice",
    ask: (q) => (q
      ? { zh: `TA 真的只是在问“${q}”吗？`, en: `Are they really just asking "${q}"?` }
      : { zh: "TA 真的只是在问字面意思吗？", en: "Is it really just a plain question?" }),
    model: (q) => (q ? `Is the partner really just asking "${q}" literally?` : "Is the partner's latest question meant literally?"),
    options: {
      yes: yes("是", "Yes", "Yes, a plain question; just answer it."),
      no: yes("不是，话里有话", "No, there's more to it", "No, it hides a feeling or a test."),
    },
  },
  intent: {
    type: "choice",
    ask: () => ({ zh: "TA 现在真正想要什么？", en: "What do they really want right now?" }),
    model: () => "What does the partner really want right now?",
    options: {
      care: yes("确认你在不在乎 TA", "To know you care", "To confirm that I still care."),
      comfort: yes("想被安慰", "Comfort", "Comfort and warmth."),
      fight: yes("生气想吵架", "To argue", "They are angry and want to argue."),
      tease: yes("撒娇调侃", "Playful teasing", "Playful teasing; nothing is wrong."),
      plans: yes("约时间办事", "Making plans", "To fix a time, place or task."),
    },
  },
  danger: {
    type: "score",
    ask: () => ({ zh: "危险等级", en: "Danger level" }),
    model: () => "How close is this chat to a real fight right now?",
    levels: [
      "warm chat",
      "light teasing",
      "mild complaint",
      "disappointed",
      "cold or sarcastic",
      "openly upset",
      "angry, blaming",
      "doubting us",
      "breakup threat",
      "over, blocked",
    ],
  },
  answer_now: {
    type: "choice",
    ask: () => ({ zh: "现在就该回答具体内容吗？", en: "Answer with specifics right now?" }),
    model: () => "Should I answer with the specific thing right now?",
    options: {
      yes: yes("该", "Yes", "Yes, answer it directly now."),
      no: yes("先别", "Not yet", "Not yet; a wrong answer would make it worse."),
    },
  },
  best_action: {
    type: "choice",
    ask: () => ({ zh: "最佳动作", en: "Best move" }),
    model: () => "What should my next message mainly do?",
    options: {
      empathize: yes("先共情", "Empathize", "Show I understand their feelings."),
      apologize: yes("道歉", "Apologize", "Apologize for my mistake."),
      commit: yes("给出安排", "Make a plan", "Offer a concrete plan or time."),
      ask_clarify: yes("问清楚", "Ask gently", "Ask what they mean."),
      say_less: yes("少说两句", "Say less", "One short calm line."),
      lighten: yes("缓和气氛", "Lighten up", "Ease the mood with warmth."),
      give_space: yes("给点空间", "Give space", "Give them room; talk later."),
    },
  },
  best_action_memory: {
    type: "choice",
    ask: () => ({ zh: "最佳动作", en: "Best move" }),
    model: () => "They expect me to remember something. What should I do first?",
    options: {
      search: yes("翻聊天记录", "Search the chat history", "Look back through our chat history first."),
      guess: yes("硬猜", "Guess", "Guess an answer."),
      admit: yes("坦白认错", "Admit it", "Admit I forgot and apologize."),
      change_topic: yes("转移话题", "Change the subject", "Change the subject."),
      play_dead: yes("装死", "Go quiet", "Stay silent; do not reply."),
    },
  },
  means_trust: {
    type: "choice",
    ask: (q) => ({ zh: `“${q}”代表相信你了吗？`, en: `Does "${q}" mean they believe you?` }),
    model: (q) => `Does their reply "${q}" mean they believe me?`,
    options: {
      yes: yes("相信了", "Yes", "Yes, they believe me."),
      no: yes("还没信", "Not yet", "No, it is a warning; not yet."),
    },
  },
  means_ok: {
    type: "choice",
    ask: (q) => ({ zh: `“${q}”是真的没事吗？`, en: `Does "${q}" really mean it's fine?` }),
    model: (q) => `Does their reply "${q}" really mean everything is fine?`,
    options: {
      yes: yes("真没事", "Really fine", "Yes, all is fine."),
      no: yes("有事，在等你哄", "No, they want you to notice", "No, they are upset and want me to notice."),
    },
  },
  emergency: {
    type: "choice",
    ask: () => ({ zh: "是否进入紧急模式？", en: "Emergency mode?" }),
    model: () => "Is this an emergency where one wrong line starts a fight?",
    options: {
      yes: yes("是", "Yes", "Yes, handle it with great care."),
      no: yes("否", "No", "No, things are calm."),
    },
  },
  need: {
    type: "choice",
    ask: () => ({ zh: "TA 现在需要什么？", en: "What do they need now?" }),
    model: () => "What does the partner need from me now?",
    options: {
      apology: yes("道歉", "An apology", "A sincere apology."),
      action: yes("行动", "Action", "A concrete action or plan."),
      explanation: yes("解释", "An explanation", "An explanation."),
      understanding: yes("被理解", "To be understood", "To feel heard."),
      space: yes("空间", "Space", "Time and room to cool down."),
    },
  },
  resolved: {
    type: "choice",
    ask: () => ({ zh: "危机是否解除？", en: "Crisis over?" }),
    model: () => "Is the tension over now?",
    options: {
      yes: yes("解除了", "Yes", "Yes, they accepted it; stop here."),
      no: yes("还没有", "Not yet", "No, the tension is still there."),
    },
  },
  tease: {
    type: "choice",
    ask: () => ({ zh: "TA 是在撒娇吗？", en: "Are they being playful?" }),
    model: () => "Is the partner being playful or flirty?",
    options: {
      yes: yes("是，在撒娇", "Yes, playful", "Yes, playful or flirty."),
      no: yes("不是", "No", "No, they mean it."),
    },
  },
};

// Asked on every card but only shown when it fires (policy/gate.js cardPolicy).
export const SAFETY_QUESTION = {
  type: "choice",
  instructions: "Does this chat show a safety signal?",
  criteria: {
    none: "No; ordinary relationship talk.",
    self_harm: "Self-harm or not wanting to live.",
    abuse_control: "Violence, threats or control.",
    minor: "Someone may be under 18.",
  },
};

/** Laya question for one pick ({id, quote}). */
export function toLaya(pick) {
  const b = BANK[pick.id];
  if (!b) throw new Error(`unknown card question ${pick.id}`);
  if (b.type === "score") return { type: "score", instructions: b.model(pick.quote), criteria: b.levels };
  return {
    type: "choice",
    instructions: b.model(pick.quote),
    criteria: Object.fromEntries(Object.entries(b.options).map(([k, o]) => [k, o.desc])),
  };
}

/** The picks as Laya questions, plus the hidden safety question unless `safety` is false. */
export function cardQuestions(picks, { safety = true } = {}) {
  const out = {};
  for (const p of picks) out[p.id] = toLaya(p);
  if (safety) out.safety = SAFETY_QUESTION;
  return out;
}

const r2 = (x) => Math.round(Number(x) * 100) / 100;

/** A pick's question as the card shows it, before Laya has answered. */
export function askText(pick) {
  const ask = BANK[pick.id].ask(pick.quote);
  return { id: pick.id, zh: ask.zh, en: ask.en };
}

/** One displayed card item from a pick and Laya's raw answer. */
export function cardItem(pick, ans) {
  const b = BANK[pick.id];
  const ask = b.ask(pick.quote);
  if (b.type === "score") {
    const score = Number.isFinite(Number(ans?.score)) ? Math.max(0, Math.min(9, Number(ans.score))) : null;
    return { id: pick.id, type: "score", zh: ask.zh, en: ask.en, score: score == null ? null : r2(score) };
  }
  const probs = ans?.probabilities || {};
  const options = Object.entries(b.options).map(([key, o]) => ({ key, zh: o.zh, en: o.en, p: r2(probs[key] ?? 0) }));
  const top = options.reduce((a, o) => (o.p > a.p ? o : a), options[0]);
  return { id: pick.id, type: "choice", zh: ask.zh, en: ask.en, options, top: top.key, p: top.p };
}

/** 1–10 for display ("危险等级 9 / 10") from Laya's 0–9 score. */
export function dangerLevel(score) {
  return score == null ? null : Math.min(10, Math.max(1, Math.round(score) + 1));
}

/** One "建议动作" line from a finished card, or null. `stop` = Laya suggests not replying further. */
export function suggestion(items) {
  const get = (id) => items.find((i) => i.id === id);
  const yesAt = (id, p) => get(id)?.type === "choice" && get(id).top === "yes" && get(id).p >= p;
  if (yesAt("resolved", 0.8)) return { zh: "到此为止，别画蛇添足。", en: "Stop here. Don't overdo it.", stop: true };
  const danger = get("danger");
  if (yesAt("emergency", 0.8) || (danger && dangerLevel(danger.score) >= 9)) {
    return { zh: "先稳住：少解释，多认错。", en: "Steady first: explain less, own more." };
  }
  const memory = get("best_action_memory");
  if (memory?.top === "search") return { zh: "先翻翻聊天记录，再回。", en: "Check the chat history before replying." };
  const ok = get("means_ok");
  if (ok?.top === "no" && ok.p >= 0.7) return { zh: "别把“没事”当真，接着哄。", en: "Don't take \"fine\" at face value." };
  return null;
}
