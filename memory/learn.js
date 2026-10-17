// One look at a person's chat for things worth keeping (docs/design/spec-auto-memory.md): the messages
// not looked at yet, the rules first, Gemma only when a line might hold something, its picks
// checked against the chat, then kept in the person's auto.json. It runs at the end of a turn,
// after the replies are out, and a new line stops it (signal): nothing half-done is kept, and the
// lines are looked at again next time.
import { isCandidate, isDuplicate, parsePicks, pickLines, pickMessages, resolveDate, withDate } from "./auto.js";

export const BASELINE_RECENT = 8; // the first look at a person: only the newest lines, not the whole old chat

/**
 * @param {{people: import("./people.js").PeopleStore, id: string,
 *   writer: {write(messages: object[], opts: {signal?: AbortSignal}): Promise<{text: string, promptN?: number, evalCount?: number}>},
 *   signal?: AbortSignal}} args
 * @returns {Promise<{candidates: number, saved: object[], ran: boolean, ms: number, promptN: number|null, evalCount: number|null}>}
 */
export async function learnFromChat({ people, id, writer, signal }) {
  const t0 = performance.now();
  const result = { candidates: 0, saved: [], ran: false, ms: 0, promptN: null, evalCount: null };
  const finish = () => ({ ...result, ms: Math.round(performance.now() - t0) });
  const thread = people.thread(id);
  const have = people.auto(id);
  const before = have.fresh ? thread.slice(0, Math.max(0, thread.length - BASELINE_RECENT)).map((m) => m.id) : [];
  const seen = new Set([...have.scanned, ...before]);
  const fresh = thread.map((m, i) => ({ m, i })).filter(({ m }) => !seen.has(m.id));
  const scanned = [...before, ...fresh.map(({ m }) => m.id)];
  const candidates = fresh.filter(({ m }) => isCandidate(m.text)).map(({ i }) => i);
  result.candidates = candidates.length;
  if (!candidates.length) {
    if (scanned.length) people.addAuto(id, { scanned });
    return finish();
  }

  const lines = pickLines(thread, candidates);
  const r = await writer.write(pickMessages(lines), { signal });
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
  result.ran = true;
  result.promptN = r.promptN ?? null;
  result.evalCount = r.evalCount ?? null;

  const picks = [];
  for (const p of parsePicks(r.text, lines)) {
    if (isDuplicate(p, [...have.memories, ...picks])) continue;
    const at = Number.isFinite(p.msg.at) ? p.msg.at : Date.now();
    const said = withDate(p.quote, at);
    // The day may sit outside the words picked ("…是我生日" from "下周六是我生日"): take it from the line.
    const date = said.date ?? resolveDate(p.msg.text, at);
    picks.push({ label: p.label, text: said.text, quote: p.quote, from: p.from, msgId: p.msg.id,
      saidAt: Number.isFinite(p.msg.at) ? p.msg.at : null, date });
  }
  result.saved = people.addAuto(id, { memories: picks, scanned });
  return finish();
}
