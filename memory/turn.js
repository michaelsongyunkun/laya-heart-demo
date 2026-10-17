// What one turn takes from the person's memory (docs/design/spec-people-memory.md): the core card for
// Gemma's fixed prompt part, plus at most two chunks that bear on what they just said. Nothing
// leaves the machine: a remote judge or drafter gets none of it.
// Laya gets none of it either. It reads its input again for every question on a card, so the
// core card's first 120 characters as its background made every card ~0.6 s slower (bench,
// 2026-10-14), and the replies wait for the card; zero-shot Laya gains little from it.
import { focusText, noteFor, partnerTurn, queryText, retrieve } from "./retrieve.js";

/**
 * @param {{memory: object|null, stage: string, thread: object[], judgeLocal: boolean, draftLocal: boolean, now?: Date}} args
 * @returns {{profile: {stage: string, background: string, core: string, notes: string[]},
 *   used: {id: string, layer: number, section: string, title: string, text: string}[], ms: number, remote: boolean}}
 */
export function memoryForTurn({ memory, stage, thread, judgeLocal, draftLocal, now = new Date() }) {
  const t0 = performance.now();
  const profile = { stage, background: "", core: "", notes: [] };
  if (!memory) return { profile, used: [], ms: 0, remote: false };
  const query = queryText(thread);
  const picked = draftLocal ? retrieve(memory.index, query, { now, asked: partnerTurn(thread) }) : [];
  if (draftLocal) {
    profile.core = memory.core;
    profile.notes = picked.map((p) => noteFor(p.chunk, query));
  }
  return {
    profile,
    // What the page lists: what Gemma read of each chunk.
    used: picked.map(({ chunk }) => ({ id: chunk.id, layer: chunk.layer, section: chunk.section, title: chunk.title, text: focusText(chunk, query) })),
    ms: Math.round((performance.now() - t0) * 10) / 10,
    remote: !judgeLocal || !draftLocal,
  };
}
