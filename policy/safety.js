// Safety signals in plain code (the "守规矩" layer is ours, not the model's).
// Keyword hits are high-precision triggers; Laya's `safety` answer only counts when it is
// confident (0.8, policy/gate.js: the line docs/fine-tuning-report.md measures recall at).
// We only remind and adjust the drafts — we never contact anyone or send anything.

const PATTERNS = {
  self_harm: [
    /自杀|轻生|想死|不想活|活不下去|活着(?:真)?没(?:什么)?意思|结束(?:自己的)?生命|割腕|跳楼|吃安眠药|自残|伤害自己|撑不下去了?/,
    /\b(?:kill myself|suicid\w*|end my life|want to die|self[- ]?harm|hurt myself)\b/i,
  ],
  abuse_control: [
    /打(?:了)?我|掐我|揍我|动手打|弄死你|杀了你|跟踪我|查我手机|不许我(?:见|出门|跟)|不让我(?:见|出门)|威胁我|锁在家/,
    /\b(?:hit me|choked? me|kill you|stalk\w*|threaten\w* me)\b/i,
  ],
  minor: [
    /未成年|我才1[0-7]岁|今年1[0-7]岁|(?:读|上)(?:初中|小学)|初[一二三]的?学生/,
    /\b(?:i'?m|i am) 1[0-7]\b|\bmiddle school\b/i,
  ],
};

export const RESOURCES = {
  zh: [
    { name: "全国统一心理援助热线", number: "12356" },
    { name: "紧急求助（报警 / 急救）", number: "110 / 120" },
  ],
  en: [
    { name: "988 Suicide & Crisis Lifeline (US)", number: "988" },
    { name: "Emergency", number: "911 / 112" },
  ],
};

/** @returns {{kind: string, source: "keyword"} | null} the first keyword signal in the chat */
export function keywordSignal(text) {
  for (const [kind, regs] of Object.entries(PATTERNS)) {
    if (regs.some((r) => r.test(text))) return { kind, source: "keyword" };
  }
  return null;
}
