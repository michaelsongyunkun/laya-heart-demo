// One turn of the web page: the partner said something new.
//   1. the newest partner turn's card, one answer at a time (core/cards.js), then its hidden
//      safety question and the policy;
//   2. the replies, written straight away (core/pipeline.js) - no button, no delay: Gemma only
//      has to read what is new (draft/llama_server.js), so starting now is the fastest way;
//   3. cards for a few earlier partner turns, once the replies are out (they only matter when a
//      whole chat was pasted at once, and must not hold up the replies).
// Events from the steps are passed on with the step's own start/done renamed, and one "done"
// closes the turn with the times the user felt, all measured from the start of the turn.
import { readCards, readOlderCards, BACKFILL } from "./cards.js";
import { draftReplies } from "./pipeline.js";

const now = () => performance.now();
const at = (t0) => Math.round(now() - t0);

/**
 * @param {{thread: object[], profile?: object, lang?: string, thresholds?: object, adultsConfirmed?: boolean}} input
 * @param {{judge: object, drafter: object|null, emit?: Function, signal?: AbortSignal, cacheTag?: string,
 *   backfill?: number}} deps  drafter null = cards only (no replies)
 */
export async function runTurn(input, { judge, drafter, emit = () => {}, signal, cacheTag = "", backfill = BACKFILL } = {}) {
  const t0 = now();
  const metrics = { kind: "turn", cardFirstMs: null, cardMs: null, safetyMs: null, policyMs: null,
    firstTokenMs: null, firstReplyMs: null, draftsMs: null, rankedMs: null, totalMs: null, bytesOut: 0,
    cardCached: false, judgeBackend: judge?.name, draftBackend: drafter?.name ?? null };

  const cards = await readCards(input, {
    judge, signal, cacheTag, backfill: 0,
    emit: (type, data) => emit(type === "start" ? "cards:start" : type === "done" ? "cards:done" : type, data),
  });
  const cm = cards.metrics;
  metrics.cardFirstMs = cm.firstMs;
  metrics.cardMs = cm.latestMs;
  metrics.safetyMs = cm.safetyMs;
  metrics.policyMs = cm.totalMs;
  metrics.bytesOut += cm.bytesOut;
  metrics.cardCached = !!cards.latest?.cached;
  const noPartner = !cards.cards.length;

  let drafts = null;
  if (drafter && !noPartner) {
    const offset = at(t0);
    drafts = await draftReplies(
      { thread: input.thread, card: cards.latest, profile: input.profile, adultsConfirmed: !!input.adultsConfirmed,
        lang: input.lang, thresholds: input.thresholds },
      { judge, drafter, signal,
        emit: (type, data) => emit(type === "start" ? "draft:begin" : type === "done" ? "draft:end" : type,
          type === "draft:first" ? { ms: offset + data.ms } : data) });
    const dm = drafts.metrics;
    const shift = (ms) => (ms == null ? null : offset + ms);
    metrics.firstTokenMs = shift(dm.firstTokenMs);
    metrics.firstReplyMs = shift(dm.firstReplyMs);
    metrics.draftsMs = dm.draftMs == null ? null : offset + (dm.totalMs - (dm.rankMs ?? 0));
    metrics.rankedMs = shift(dm.totalMs);
    metrics.bytesOut += dm.bytesOut;
    metrics.draftPromptTokens = dm.draftPromptTokens ?? null;
    metrics.draftCachedTokens = dm.draftCachedTokens ?? null;
    metrics.draftPromptMs = dm.draftPromptMs ?? null;
    metrics.draftTokens = dm.draftTokens ?? null;
    metrics.blocked = !!drafts.blocked;
  }

  if (backfill > 0 && !noPartner) {
    await readOlderCards(input, { judge, signal, cacheTag, backfill, emit });
  }
  metrics.totalMs = at(t0);
  emit("done", { metrics, noPartner });
  return { cards, drafts, metrics };
}
