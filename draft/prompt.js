// Turns a ChatState + Laya's card into the drafting prompt for Gemma.
// The reads are not decoration: each answer on the latest card ("needs now", "best move",
// danger level, "is it really fine?") becomes a writing instruction (PPT p.9 notes).
//
// Laid out for speed (2026-10-14). On a laptop CPU Gemma reads ~55 tokens/s, so what it has to
// read again for each new line is most of the wait. llama-server keeps what it has read
// (draft/llama_server.js), so the prompt is ordered from "never changes" to "changes every time":
//   system: the rules, identical for every request (read once, at start-up);
//   user:   relationship and the person's core card (速览, memory/book.js), then the chat,
//           which only grows at the end (draftWindow drops old lines 8 at a time, not one by one);
//           then a short tail, the only part read anew: the memory chunks that bear on this
//           line (memory/retrieve.js, at most two), Laya's reads as instructions, the ask.
import { STAGES } from "../judge/questions.js";
import { dangerLevel } from "../judge/bank.js";
import { buildChatState, transcript } from "../judge/state.js";

export const N_CANDIDATES = 2;
export const MAX_CHARS = 40;
// The drafting window: up to MAX messages; when it overflows, the oldest CHUNK go at once.
export const DRAFT_WINDOW = { max: 16, chunk: 8 };

const ACTION_HINT = {
  empathize: "先说出你理解对方的感受，不辩解、不讲道理。",
  apologize: "先为对话里出现过的具体的事真诚道歉，不找借口。",
  commit: "给出具体、做得到的安排；时间地点只用对话里已有的，不要自己编。",
  ask_clarify: "温和地问一句，弄清对方的意思或需要。",
  check_facts: "坦白说需要确认一下，不要假装记得，也不要编造。",
  say_less: "只写很短的一句，语气平和，不展开解释。",
  lighten: "用一点轻松或亲昵的语气缓和气氛，但不拿对方的感受开玩笑。",
  give_space: "表示理解，给对方空间，说明等对方愿意时再聊。",
  call: "真诚地提议打个电话或当面聊，不施压。",
  // best_action_memory (the partner expects "me" to remember something)
  search: "对方在等你记起一件事：别瞎编，先说你在认真回想，确认了再说具体的。",
  guess: "拿不准的事别硬猜，坦白说需要想一想。",
  admit: "坦白承认自己忘了，真诚道歉，再请对方告诉你。",
  change_topic: "别转移话题，正面回应对方。",
  play_dead: "别不回，先回一句稳住对方。",
};

const INTENT_HINT = {
  care: "TA 想确认你在乎 TA：让 TA 感到被在乎。",
  comfort: "TA 想被安慰：先安慰。",
  fight: "TA 在气头上：别接火，别争对错。",
  tease: "TA 在撒娇调侃：轻松回应，可以一起开个玩笑。",
  plans: "TA 在约时间办事：回应具体安排，时间地点只用对话里已有的。",
};

// Yes/no questions on a card -> how to write.
const ANSWER_HINT = {
  literal: { yes: "就是字面意思，直接回答。", no: "对方话里有话：回应背后的情绪，别只答字面。" },
  answer_now: { yes: "直接、具体地回答对方。", no: "先别急着给具体答案，先稳住，表示你在认真对待。" },
  means_trust: { yes: "对方已经信了，简短确认即可。", no: "对方还没信：用具体的细节或行动说话，别空口保证。" },
  means_ok: { yes: "对方是真没事，轻松回应就好。", no: "别把“没事”当真，温柔地接住对方的情绪。" },
  emergency: { yes: "紧急模式：非常克制，不辩解、不讲道理、不开玩笑。" },
  resolved: { yes: "危机已解除：简短温暖地收个尾，别画蛇添足，别再翻旧事。", no: "还没翻篇，继续认真回应。" },
  tease: { yes: "对方在撒娇，可以亲昵、轻松一点。" },
};

const NEED_HINT = {
  understanding: "TA 需要被理解。",
  apology: "TA 需要一句真诚的道歉。",
  action: "TA 需要一个具体的行动或安排。",
  explanation: "TA 需要你把事情解释清楚。",
  space: "TA 需要空间，别追问。",
  nothing: "简单回应就好，不用展开。",
};

const TIMING_HINT = {
  reply_now: "现在就完整地回。",
  hold_line: "先发一句稳住对方的话，详细的晚点再说。",
  wait: "最好等一等再回，所以草稿写得短一点、缓一点。",
  voice: "更适合改成语音或电话，草稿可以提议通话。",
};

const SAFETY_HINT = {
  self_harm:
    "对方可能提到了自伤或不想活：必须认真、温暖地回应，直接关心对方现在是否安全，表示你愿意陪着，并鼓励联系专业帮助；不开玩笑、不说“别想太多”。",
  abuse_control:
    "对话里可能有暴力、威胁或控制：保持冷静、不激化、不挑衅，把安全放在第一位。",
  minor: "对话可能涉及未成年人：不得包含任何恋爱或亲密内容。",
};

function heatHint(score) {
  if (score == null) return "";
  const lvl = dangerLevel(score);
  if (score <= 2) return `危险等级 ${lvl}/10：语气可以轻松自然。`;
  if (score <= 5) return `危险等级 ${lvl}/10：语气认真、温和，不开玩笑。`;
  return `危险等级 ${lvl}/10：非常克制，不争辩、不讲道理、不开玩笑、不说教。`;
}

/** True when the partner's latest message is written in a Latin script (no CJK). */
export function partnerWritesLatin(state) {
  const msgs = state.chat.messages.filter((m) => m.from === "partner");
  const last = (msgs[msgs.length - 1] || state.chat.messages[state.chat.messages.length - 1]).text;
  return /[A-Za-z]/.test(last) && !/[぀-ヿ㐀-鿿가-힯]/.test(last);
}

function pct(p) {
  return `${Math.round((p || 0) * 100)}%`;
}

/**
 * Writing guidance from the latest per-message card (core/cards.js): `read` says what Laya
 * read (for people: the panel and dev scripts), `do` is what Gemma is told, one short line each.
 * @returns {{read: string[], do: string[], heat: number|null, bestAction: string|null}|null}
 */
export function guidanceFromCard(card) {
  if (!card?.items?.length) return null;
  const read = [];
  const dos = [];
  let heat = null;
  let bestAction = null;
  for (const it of card.items) {
    if (it.type === "score") {
      if (it.score == null) continue;
      heat = it.score;
      read.push(`危险等级 ${dangerLevel(it.score)}/10`);
      dos.push(heatHint(it.score));
      continue;
    }
    const top = it.options.find((o) => o.key === it.top);
    read.push(`${it.zh} → ${top?.zh ?? it.top}（${pct(it.p)}）`);
    let hint;
    if (it.id === "best_action" || it.id === "best_action_memory") hint = ACTION_HINT[it.top];
    else if (it.id === "need") hint = NEED_HINT[it.top];
    else if (it.id === "intent") hint = INTENT_HINT[it.top];
    else hint = ANSWER_HINT[it.id]?.[it.top];
    if (it.id === "best_action") bestAction = it.top;
    if (hint) dos.push(hint);
  }
  return { read, do: dos, heat, bestAction };
}

/** The same guidance from the 7-question judgments (judge/normalize.js); used by dev scripts. */
export function guidanceFromJudgments(j) {
  if (!j) return null;
  const read = [];
  const dos = [];
  if (j.intent) read.push(`对方真正想要：${j.intent.labelZh}（把握 ${pct(j.intent.p)}）`);
  if (j.conflict_risk) read.push(`火药味：${j.conflict_risk.score.toFixed(1)}/9`);
  if (j.need) dos.push(NEED_HINT[j.need.value] || `TA 需要：${j.need.labelZh}`);
  if (j.best_action) dos.push(ACTION_HINT[j.best_action.value] || `先做：${j.best_action.labelZh}`);
  if (j.timing) dos.push(TIMING_HINT[j.timing.value] || j.timing.labelZh);
  if (j.conflict_risk) dos.push(heatHint(j.conflict_risk.score));
  return { read, do: dos.filter(Boolean), heat: j.conflict_risk?.score ?? null, bestAction: j.best_action?.value ?? null };
}

/** The messages Gemma sees: all of them up to DRAFT_WINDOW.max, then old ones go CHUNK at a time. */
export function draftWindow(thread, { max = DRAFT_WINDOW.max, chunk = DRAFT_WINDOW.chunk } = {}) {
  const msgs = (thread || []).filter((m) => m && (m.from === "partner" || m.from === "me") && String(m.text || "").trim());
  if (msgs.length <= max) return msgs;
  const start = Math.ceil((msgs.length - max) / chunk) * chunk;
  return msgs.slice(start);
}

/** ChatState for drafting: the drafting window, not the judge's last 10 lines. */
export function draftState(thread, profile = {}) {
  const msgs = draftWindow(thread);
  return buildChatState(msgs, profile, { maxMessages: msgs.length });
}

// Identical for every request, so llama-server reads it once and keeps it.
export const SYSTEM_PROMPT = [
  "你是 Laya-Heart 的起草助手，帮「我」给伴侣写聊天回复草稿，发不发由「我」自己决定。",
  "要求：",
  `1. 只输出 ${N_CANDIDATES} 行，每行一条候选回复。不要开场白、编号、引号、标签或解释。`,
  `2. 每条不超过 ${MAX_CHARS} 个字，像微信里打字的口语；对方用什么语言，你就用什么语言。`,
  "3. 只用对话、「速览」和「我记得的事」里有的事实；不编造时间、地点、数字或经历，不替「我」做对话里没有的承诺。",
  "4. 不贬低、不讽刺、不威胁、不冷暴力、不 PUA、不内疚绑架、不说脏话。",
  "5. 两条要有区别：第 1 条最稳妥；第 2 条更温暖、更具体。",
  "6. 用户消息最后几行：「我记得的事」是我自己记下的，用得上就自然地用，别逐字照搬；「Laya 的判断换成的写法」照着写，但判断只供参考，和对话矛盾时以对话为准。",
].join("\n");

/** Relationship and the core card: the start of the user message, the same for every turn. */
export function chatHeader(profile = {}, background = "") {
  const stage = STAGES[profile.stage] || STAGES.dating;
  const lines = [`关系：${stage.zh}`];
  if (profile.core) lines.push("速览（我自己记的）：", profile.core);
  else if (background) lines.push(`背景：${background}`);
  lines.push("", "对话（从早到晚）：");
  return lines.join("\n");
}

/** The user message up to the end of the chat: the part that stays the same as the chat grows. */
export function chatBlock(state, profile = {}) {
  return [chatHeader(profile, state.chat.background), transcript(state), ""].join("\n");
}

/** The drafting prompt up to the end of the chat, to read ahead when a person is opened. */
export function prefixMessages(thread, profile = {}) {
  const user = draftWindow(thread).length ? chatBlock(draftState(thread, profile), profile).trimEnd() : chatHeader(profile);
  return [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: user }];
}

/**
 * @param {object} state ChatState from judge/state.js (use draftState for the app's window)
 * @param {{read: string[], do: string[]}|null} guidance  guidanceFromCard / guidanceFromJudgments
 * @param {{mode: string, safety?: string}} policy  from policy/gate.js
 * @param {{stage?: string, background?: string, core?: string, notes?: string[]}} profile
 *   core: the person's core card; notes: memory chunks for this line (memory/turn.js)
 */
export function buildDraftMessages(state, guidance, policy, profile = {}) {
  const notes = (profile.notes || []).filter(Boolean);
  const remember = notes.length ? ["我记得的事：", ...notes.map((n) => `- ${n}`)] : [];
  const tail = [];
  if (guidance?.do?.length) tail.push(...guidance.do.map((d) => `- ${d}`));
  if (policy?.mode === "uncertain") tail.push("- Laya 把握不高：写得中性一些，可以温和地问一句对方的意思。");
  if (policy?.safety && SAFETY_HINT[policy.safety]) tail.push(`- 重要：${SAFETY_HINT[policy.safety]}`);
  const latin = partnerWritesLatin(state);
  if (latin) tail.push("- 对方用的是英文：每条都用英文写。");
  const head = tail.length ? ["Laya 的判断换成的写法：", ...tail] : [];
  const ask = latin ? `Write ${N_CANDIDATES} replies in English, one per line.` : `写 ${N_CANDIDATES} 条回复，每行一条。`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: [chatBlock(state, profile), ...remember, ...head, ask].join("\n") },
  ];
}
