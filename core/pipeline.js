// The replies, written right after the newest card (core/turn.js), or again on "another set":
// latest card -> policy -> draft (Gemma) -> rank (Laya + rules).
// Pure orchestration with injected backends, so the web server, the scripts and the tests all
// run the same code. Logs and metrics carry numbers only, never chat text.
import { askSafety } from "./cards.js";
import { rankQuestion } from "../judge/questions.js";
import { buildChatState, chatText, judgeText } from "../judge/state.js";
import { cardPolicy, DEFAULT_THRESHOLDS } from "../policy/gate.js";
import { rankCandidates, SAFETY_TEMPLATES } from "../policy/rank.js";
import { buildDraftMessages, draftState, guidanceFromCard, N_CANDIDATES } from "../draft/prompt.js";
import { finishedCandidates, parseCandidates } from "../draft/parse.js";

const now = () => performance.now();

/**
 * The drafting prompt for a chat and its newest card, exactly as draftReplies sends it
 * (the fine-tune kit builds its Gemma rows with this, so training and the app match).
 */
export function draftPrompt({ thread, card, profile, thresholds }) {
  const state = draftState(thread, profile);
  const policy = cardPolicy(card, chatText(state), thresholds || DEFAULT_THRESHOLDS);
  const guidance = guidanceFromCard(card);
  return { policy, guidance, state, messages: buildDraftMessages(state, guidance, policy, profile) };
}

/**
 * @typedef {{name: string, label: string, local: boolean,
 *   predict(state: object, questions: object, opts?: {signal?: AbortSignal}): Promise<{answers: object, usage?: object, bytesOut?: number}>}} Judge
 * @typedef {{name: string, label: string, local: boolean,
 *   draft(messages: object[], opts: {onDelta?: (text: string) => void, signal?: AbortSignal}): Promise<{text: string, bytesOut?: number, evalCount?: number|null, firstTokenMs?: number|null}>}} Drafter
 *
 * @param {{thread: object[], card?: object|null, profile?: object, adultsConfirmed?: boolean,
 *   lang?: string, thresholds?: object}} input  `card` is the latest card from readCards
 * @param {{judge: Judge, drafter: Drafter, emit?: (type: string, data: object) => void, signal?: AbortSignal}} deps
 */
export async function draftReplies(input, { judge, drafter, emit = () => {}, signal } = {}) {
  const t0 = now();
  const metrics = { kind: "draft", draftMs: null, rankMs: null, totalMs: null, bytesOut: 0,
    firstTokenMs: null, firstReplyMs: null,
    judgeBackend: judge?.name, draftBackend: drafter?.name, judgeLocal: !!judge?.local, draftLocal: !!drafter?.local };
  const judged = buildChatState(input.thread, input.profile); // what Laya reads: the last 10 lines
  const card = input.card && !input.card.error ? { ...input.card } : null;

  // 1. Rules that are ours, not the model's. If the card's hidden safety question has not been
  //    asked yet (readCards asks it right after the card), it is asked here first.
  if (card && card.safety === undefined) {
    try {
      const r = await askSafety(judge, judgeText(judged), { signal });
      card.safety = r.safety;
      metrics.bytesOut += r.bytesOut;
    } catch (e) {
      if (signal?.aborted) throw e;
      card.safety = null;
    }
  }
  const { policy, guidance, state, messages } = draftPrompt({ thread: input.thread, card, profile: input.profile, thresholds: input.thresholds });
  const chat = chatText(state);
  const partnerMsgs = state.chat.messages.filter((m) => m.from === "partner");
  const latest = (partnerMsgs[partnerMsgs.length - 1] || state.chat.messages[state.chat.messages.length - 1]).text;
  emit("start", { messages: state.chat.messages.length, drafter: drafter?.label });
  emit("policy", policy);
  const template = policy.safety && SAFETY_TEMPLATES[policy.safety]
    ? SAFETY_TEMPLATES[policy.safety][input.lang === "en" ? "en" : "zh"] : null;
  if (policy.blockDraft && !input.adultsConfirmed) {
    metrics.totalMs = Math.round(now() - t0);
    emit("done", { metrics, blocked: true });
    return { policy, ranked: [], template: null, metrics, blocked: true };
  }

  // 2. Draft, with the card's answers as writing instructions. Lines stream to the page as
  //    they are written; the first finished line is the first reply the user can take.
  let t = now();
  emit("draft:start", {});
  let candidates = [];
  let draftError = null;
  const onDelta = (text) => {
    metrics.firstTokenMs ??= Math.round(now() - t0);
    if (metrics.firstReplyMs == null && finishedCandidates(text, 1).length) {
      metrics.firstReplyMs = Math.round(now() - t0);
      emit("draft:first", { ms: metrics.firstReplyMs });
    }
    emit("draft:delta", { text });
  };
  try {
    const r = await drafter.draft(messages, { signal, onDelta });
    metrics.bytesOut += r.bytesOut || 0;
    metrics.draftTokens = r.evalCount ?? null;
    metrics.draftLoadMs = r.loadMs ?? null;
    metrics.draftPromptTokens = r.promptEvalCount ?? r.promptN ?? null;
    metrics.draftCachedTokens = r.cacheN ?? null;
    metrics.draftPromptMs = r.promptMs ?? null;
    candidates = parseCandidates(r.text, N_CANDIDATES);
  } catch (e) {
    if (signal?.aborted) throw e;
    draftError = String(e?.message || e);
  }
  metrics.draftMs = Math.round(now() - t);
  metrics.firstReplyMs ??= candidates.length ? metrics.draftMs + Math.round(t - t0) : null;
  emit("draft:done", { candidates, error: draftError, ms: metrics.draftMs });

  // 3. Pick the best: Laya's rank question + code-rule penalties.
  t = now();
  let rankProbs = null;
  let rankError = null;
  if (candidates.length >= 2 && card) {
    try {
      const r = await judge.predict(judgeText(judged), rankQuestion(candidates), { signal });
      metrics.bytesOut += r.bytesOut || 0;
      rankProbs = r.answers?.rank?.probabilities || null;
    } catch (e) {
      if (signal?.aborted) throw e;
      rankError = String(e?.message || e);
    }
  }
  const ranked = rankCandidates(candidates, rankProbs,
    { chat, latest, bestAction: guidance?.bestAction, heat: guidance?.heat });
  metrics.rankMs = Math.round(now() - t);
  metrics.totalMs = Math.round(now() - t0);
  emit("rank:done", { ranked, template, error: rankError, ms: metrics.rankMs });
  emit("done", { metrics });
  return { policy, ranked, template, metrics, errors: { draftError, rankError } };
}
