// "Read them" as per-message cards: each partner turn gets 1–3 short questions
// (judge/select.js), asked one at a time so each answer shows as soon as Laya has it. The
// newest turn goes first; Laya's hidden safety question is asked right after that card is
// complete, so it never holds up what the user is waiting for (keyword signals still show at
// once). Up to BACKFILL earlier turns follow, without the safety question. A card is cached by
// the exact chat it was asked on, so a new line only pays for what is new and the same chat
// always shows the same card. Logs and metrics carry numbers only.
import { buildChatState, chatText, judgeText } from "../judge/state.js";
import { cardTargets, pickQuestions } from "../judge/select.js";
import { BANK_VERSION, SAFETY_QUESTION, askText, cardQuestions, cardItem, suggestion } from "../judge/bank.js";
import { cardPolicy, DEFAULT_THRESHOLDS } from "../policy/gate.js";
import { SAFETY_TEMPLATES } from "../policy/rank.js";

export const BACKFILL = 5;
const CACHE_MAX = 64;
const cache = new Map();
const now = () => performance.now();

const keyOf = (tag, text) => JSON.stringify([BANK_VERSION, tag, text]);
const textAt = (thread, idx, profile) => judgeText(buildChatState(thread.slice(0, idx + 1), profile));

export function clearCardCache() {
  cache.clear();
}

function remember(key, card) {
  cache.delete(key);
  cache.set(key, card);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function stopIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
}

/** Laya's hidden safety question on one chat: the top answer as {value, p}, or null. */
export async function askSafety(judge, text, { signal } = {}) {
  const r = await judge.predict(text, { safety: SAFETY_QUESTION }, { signal });
  const s = r.answers?.safety;
  return { safety: s?.probabilities ? { value: s.choice, p: Number(s.probabilities[s.choice] ?? 0) } : null, bytesOut: r.bytesOut || 0 };
}

// One card, one question at a time: "card:start" lists the questions, "card:item" brings each
// answer as soon as Laya has it. A card served from the cache emits neither.
async function askCard(thread, idx, prev, text, { judge, profile, signal, tag, emit }) {
  const key = keyOf(tag, text);
  const hit = cache.get(key);
  if (hit) return { ...hit, idx, cached: true, bytesOut: 0 };
  const picks = pickQuestions(thread, idx, prev);
  emit("card:start", { idx, questions: picks.map(askText) });
  const t = now();
  const items = [];
  let bytesOut = 0;
  let truncated = false;
  for (const pick of picks) {
    const r = await judge.predict(text, cardQuestions([pick], { safety: false }), { signal });
    stopIfAborted(signal);
    bytesOut += r.bytesOut || 0;
    truncated ||= !!r.usage?.truncated;
    const item = cardItem(pick, r.answers?.[pick.id]);
    items.push(item);
    emit("card:item", { idx, item });
  }
  const card = { items, suggest: suggestion(items), truncated, ms: Math.round(now() - t) };
  remember(key, card);
  return { ...card, idx, cached: false, bytesOut };
}

/**
 * @param {{thread: {from: string, text: string}[], profile?: object, lang?: string, thresholds?: object}} input
 * @param {{judge: object, emit?: (type: string, data: object) => void, signal?: AbortSignal, cacheTag?: string}} deps
 *   cacheTag names the judge setup (backend, model folder) so cards from another model are not reused.
 *   backfill: how many earlier turns get a card after the newest (0 = newest only; the web page
 *   asks for them with readOlderCards once the replies are written).
 */
export async function readCards(input, { judge, emit = () => {}, signal, cacheTag = "", backfill = BACKFILL } = {}) {
  const t0 = now();
  const thread = input.thread || [];
  const profile = input.profile || {};
  const tag = `${judge?.name}|${cacheTag}`;
  const metrics = { kind: "cards", cards: 0, cached: 0, firstMs: null, latestMs: null, safetyMs: null, totalMs: null,
    bytesOut: 0, judgeBackend: judge?.name, judgeLocal: !!judge?.local, truncated: false };
  const targets = cardTargets(thread);
  emit("start", { targets });
  if (!targets.length) {
    metrics.totalMs = Math.round(now() - t0);
    emit("done", { metrics, noPartner: true });
    return { cards: [], policy: null, metrics };
  }

  const latest = targets[targets.length - 1];
  let firstAt = null;
  const emitCard = (type, data) => {
    if (type === "card:item" && data.idx === latest) firstAt ??= now();
    emit(type, data);
  };
  const cards = [];
  const ask = async (idx, prev) => {
    let card;
    try {
      card = await askCard(thread, idx, prev, textAt(thread, idx, profile), { judge, profile, signal, tag, emit: emitCard });
      metrics.cards += 1;
      metrics.cached += card.cached ? 1 : 0;
      metrics.bytesOut += card.bytesOut;
      metrics.truncated ||= card.truncated;
    } catch (e) {
      if (signal?.aborted) throw e;
      card = { idx, error: String(e?.message || e) };
    }
    cards.push(card);
    emit("card", { card });
    return card;
  };

  // 1. The newest turn first; the previous turn's card steers it only if we already have it.
  const prevIdx = targets.length > 1 ? targets[targets.length - 2] : null;
  const prevCard = prevIdx == null ? null : cache.get(keyOf(tag, textAt(thread, prevIdx, profile))) || null;
  const latestCard = await ask(latest, prevCard);
  metrics.latestMs = Math.round(now() - t0);
  metrics.firstMs = firstAt == null ? metrics.latestMs : Math.round(firstAt - t0);

  // 2. Our rules on top of it: safety notice, the human-written safe reply, uncertainty.
  //    Keyword signals are known at once; Laya's hidden safety question is asked only now.
  const chat = chatText(buildChatState(thread, profile));
  const policyOf = (card) => {
    const p = cardPolicy(card, chat, input.thresholds || DEFAULT_THRESHOLDS);
    const template = p.safety && SAFETY_TEMPLATES[p.safety]
      ? SAFETY_TEMPLATES[p.safety][input.lang === "en" ? "en" : "zh"] : null;
    return { ...p, template };
  };
  let policy = policyOf(latestCard.error ? null : latestCard);
  if (!latestCard.error && latestCard.safety === undefined) {
    if (policy.safety) emit("policy", policy);
    const t = now();
    let safety = null;
    try {
      const text = textAt(thread, latest, profile);
      const r = await askSafety(judge, text, { signal });
      safety = r.safety;
      metrics.bytesOut += r.bytesOut;
      const hit = cache.get(keyOf(tag, text));
      if (hit) hit.safety = safety;
    } catch (e) {
      if (signal?.aborted) throw e; // otherwise: keywords only this time, and asked again next time
    }
    stopIfAborted(signal);
    latestCard.safety = safety;
    metrics.safetyMs = Math.round(now() - t);
    emit("card:safety", { idx: latest, safety });
    policy = policyOf(latestCard);
  }
  emit("policy", policy);

  // 3. Earlier turns, oldest first, so each can lean on the one before it.
  let prev = null;
  for (const idx of olderTargets(targets, backfill)) {
    stopIfAborted(signal);
    prev = await ask(idx, prev);
  }
  metrics.totalMs = Math.round(now() - t0);
  emit("done", { metrics });
  return { cards, latest: latestCard, policy, template: policy.template, metrics };
}

const olderTargets = (targets, n) => (n > 0 ? targets.slice(Math.max(0, targets.length - 1 - n), -1) : []);

/**
 * Cards for up to `backfill` partner turns before the newest one, oldest first, without the
 * safety question; turns already read come from the cache. Emits "card:start", "card:item" and
 * "card" like readCards. Returns the cards.
 */
export async function readOlderCards(input, { judge, emit = () => {}, signal, cacheTag = "", backfill = BACKFILL } = {}) {
  const thread = input.thread || [];
  const profile = input.profile || {};
  const tag = `${judge?.name}|${cacheTag}`;
  const cards = [];
  let prev = null;
  for (const idx of olderTargets(cardTargets(thread), backfill)) {
    stopIfAborted(signal);
    let card;
    try {
      card = await askCard(thread, idx, prev, textAt(thread, idx, profile), { judge, profile, signal, tag, emit });
    } catch (e) {
      if (signal?.aborted) throw e;
      card = { idx, error: String(e?.message || e) };
    }
    cards.push(card);
    emit("card", { card });
    prev = card.error ? null : card;
  }
  return cards;
}
