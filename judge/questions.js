// Laya-Heart question set v1 (draft, 2026-10-13).
//
// One question set serves three jobs: the app asks it at runtime, the fine-tune data is
// labelled against it, and the benchmark scores every judge (Laya zero-shot, Laya-Heart,
// Jev) on it. Change it only together with the labelling guide.
//
// Writing rules adapted from jev-chat-jarvis cn/tools/jev/questions.py (MIT, see CREDITS.md):
// instructions and criteria in English, chat text stays in its original language, score
// levels describe concrete scenes rather than abstract degrees, and questions must not
// contradict each other. The questions themselves are our own (couple chat, 8 questions).
//
// Laya budget: every question's instructions + options must fit head_max_len (256 tokens for
// laya-multilingual), each option is cut at 48 tokens. So options stay short; long criteria
// would silently truncate the instructions. `test/unit/questions.test.js` guards the shape.
// Yes/no is a two-option `choice`, not `noul`: Laya's model card reports a bias on noul.

export const QUESTION_SET_VERSION = "v1-draft-2026-10-13";

export const JUDGE_QUESTIONS = {
  intent: {
    type: "choice",
    instructions:
      "What does the partner really want with their latest message? Read tone and context, not only the words.",
    criteria: {
      seek_comfort: "They feel low or stressed and want warmth and comfort.",
      test_care: "They are testing whether you notice, remember, or still care.",
      vent: "They are upset and want the feeling heard; complaints or blame.",
      reconcile: "They apologize or soften to make up after a conflict.",
      make_plans: "They want to arrange or confirm a time, place, or task.",
      flirt_tease: "Playful, affectionate teasing or flirting; nothing is wrong.",
      withdraw: "They are pulling away: cold, minimal, avoiding the topic.",
      ultimatum: "They set a final condition or threaten to end things.",
    },
  },
  conflict_risk: {
    type: "score",
    instructions:
      "How close is this chat to a real fight right now? Score the current moment, not an earlier one.",
    criteria: [
      "Warm small talk or sharing; nothing is wrong.",
      "A light tease or tiny reminder that is easy to laugh off.",
      "A mild complaint without heat; they still sound warm.",
      "Clear disappointment about being forgotten, ignored, or kept waiting.",
      "Sarcasm or cold one-word replies such as 'whatever' or 'fine'.",
      "Openly upset: they say you do not listen or do not care.",
      "Angry and blaming you; one wrong line will start a fight.",
      "They question the relationship or bring up old hurts.",
      "A breakup threat or ultimatum is on the table.",
      "Rupture: they said it is over, blocked you, or are exploding.",
    ],
  },
  need: {
    type: "choice",
    instructions:
      "What does the partner need from you right now? Judge the latest message first. A sarcastic 'it is fine' is not nothing.",
    criteria: {
      understanding: "To feel heard; feelings acknowledged, not fixed or argued.",
      apology: "A sincere apology for something you did.",
      action: "A concrete action, plan, time, or change.",
      explanation: "A clear account of what happened or why.",
      space: "Time to cool down; more messages feel like pressure.",
      nothing: "Nothing more; they are content or the topic is closed.",
    },
  },
  best_action: {
    type: "choice",
    instructions:
      "What should my next message mainly do? Choose the type of action only, not the timing.",
    criteria: {
      empathize: "Reflect their feelings first; do not defend yourself.",
      apologize: "Lead with a sincere apology for a named mistake.",
      commit: "Give a concrete promise, plan, or time.",
      ask_clarify: "Ask a gentle question to understand what they mean.",
      check_facts: "A fact is missing; find out before claiming anything.",
      say_less: "One short calm line; more words would make it worse.",
      lighten: "Ease the mood with warmth or light humor; tension is low.",
      give_space: "Acknowledge and give them room; talk later.",
      call: "Suggest a call or meeting; text is making it worse.",
    },
  },
  timing: {
    type: "choice",
    instructions: "When should I reply to the latest message?",
    criteria: {
      reply_now: "Reply fully now; they are waiting for me.",
      hold_line: "Send one short holding line now, reply fully later.",
      wait: "Wait a while; an instant reply would escalate.",
      voice: "Switch to a voice message or a call.",
    },
  },
  resolved: {
    type: "choice",
    instructions: "Is the tension between us resolved right now?",
    criteria: {
      yes: "No tension left: they accepted, laughed, or it was never tense.",
      no: "Tension remains: sarcasm, a fake 'it is fine', open blame, or a test.",
    },
  },
  safety: {
    type: "choice",
    instructions:
      "Does this chat show a safety signal that needs more than relationship advice?",
    criteria: {
      none: "No safety signal; ordinary relationship talk.",
      self_harm: "Mentions self-harm, suicide, or not wanting to live.",
      abuse_control: "Violence, threats, stalking, or controlling behaviour.",
      minor: "Signs that someone in the chat is under 18.",
    },
  },
};

export const RANK_KEYS = ["reply_a", "reply_b", "reply_c"];

/** Question 8: candidates go into the options, not the state (Laya's browser-agent notes). */
export function rankQuestion(candidates) {
  const list = candidates.slice(0, RANK_KEYS.length);
  if (list.length < 2) throw new Error("rankQuestion needs at least 2 candidates");
  const criteria = {};
  list.forEach((text, i) => {
    criteria[RANK_KEYS[i]] = text;
  });
  return {
    rank: {
      type: "choice",
      instructions:
        "Which candidate is the best next message for me to send, given the chat and what the partner needs? Avoid dismissive, over-promising, or made-up replies.",
      criteria,
    },
  };
}

/** Display labels for the panel (zh / en). Keys mirror JUDGE_QUESTIONS. */
export const LABELS = {
  intent: {
    zh: "对方想说啥", en: "What they want",
    options: {
      seek_comfort: { zh: "求安慰", en: "Wants comfort" },
      test_care: { zh: "试探你在不在乎", en: "Testing if you care" },
      vent: { zh: "发泄不满", en: "Venting" },
      reconcile: { zh: "道歉求和", en: "Making up" },
      make_plans: { zh: "约事情", en: "Making plans" },
      flirt_tease: { zh: "撒娇调侃", en: "Flirting / teasing" },
      withdraw: { zh: "冷淡疏远", en: "Pulling away" },
      ultimatum: { zh: "下最后通牒", en: "Ultimatum" },
    },
  },
  conflict_risk: { zh: "火药味", en: "Heat" },
  need: {
    zh: "此刻最需要", en: "Needs now",
    options: {
      understanding: { zh: "被理解", en: "To be understood" },
      apology: { zh: "一句道歉", en: "An apology" },
      action: { zh: "一个行动", en: "An action" },
      explanation: { zh: "一个解释", en: "An explanation" },
      space: { zh: "一点空间", en: "Some space" },
      nothing: { zh: "不用回应", en: "Nothing more" },
    },
  },
  best_action: {
    zh: "建议先做", en: "Do first",
    options: {
      empathize: { zh: "共情", en: "Empathize" },
      apologize: { zh: "道歉", en: "Apologize" },
      commit: { zh: "给承诺", en: "Commit" },
      ask_clarify: { zh: "问清楚", en: "Ask gently" },
      check_facts: { zh: "先查事实", en: "Check facts" },
      say_less: { zh: "少说话", en: "Say less" },
      lighten: { zh: "缓和气氛", en: "Lighten up" },
      give_space: { zh: "留点空间", en: "Give space" },
      call: { zh: "改打电话", en: "Call instead" },
    },
  },
  timing: {
    zh: "什么时候回", en: "When to reply",
    options: {
      reply_now: { zh: "马上回", en: "Reply now" },
      hold_line: { zh: "先稳住一句", en: "Hold line first" },
      wait: { zh: "等一等", en: "Wait a bit" },
      voice: { zh: "改成语音", en: "Switch to voice" },
    },
  },
  resolved: {
    zh: "翻篇了吗", en: "Resolved?",
    options: { yes: { zh: "翻篇了", en: "Resolved" }, no: { zh: "还没翻篇", en: "Not yet" } },
  },
  safety: {
    zh: "危险信号", en: "Safety",
    options: {
      none: { zh: "没有", en: "None" },
      self_harm: { zh: "提到自伤", en: "Self-harm" },
      abuse_control: { zh: "暴力或控制", en: "Abuse / control" },
      minor: { zh: "可能是未成年人", en: "Possible minor" },
    },
  },
};

/** Relationship stages: the idea of stage-aware judging is borrowed from jev-chat-jarvis
 * global/RomanceScene (MIT); the wording below is ours. */
export const STAGES = {
  just_met: {
    zh: "刚认识", en: "Just met",
    state: "Just met, for example on a dating app; friendly and polite, no flirting yet.",
  },
  talking: {
    zh: "暧昧期", en: "Talking stage",
    state: "Talking stage before dating; light mutual flirting, no confession yet.",
  },
  dating: {
    zh: "在交往", en: "Dating",
    state: "Dating; close, missing each other and wanting to meet is normal.",
  },
  partner: {
    zh: "稳定伴侣", en: "Long-term partner",
    state: "Long-term partners; full intimacy, pet names and 'I love you' are normal.",
  },
  ex: {
    zh: "前任", en: "Ex",
    state: "Former partners; contact is unusual and should stay respectful.",
  },
};
