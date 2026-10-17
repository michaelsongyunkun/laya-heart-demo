// "挑最合适的": Laya's question 8 (which candidate is best) minus the code-rule penalties.
import { RANK_KEYS } from "../judge/questions.js";
import { checkCandidate } from "./checks.js";

// A fixed, human-written option that is always offered when self-harm comes up, so the
// panel never depends on a small model to say the safe thing.
export const SAFETY_TEMPLATES = {
  self_harm: {
    zh: "我很在乎你，你现在安全吗？我想陪着你，我们也可以一起打 12356 心理援助热线聊聊。",
    en: "I care about you a lot. Are you safe right now? I want to be with you, and we can call a crisis line together.",
  },
};

/**
 * @param {string[]} candidates
 * @param {Record<string, number>|null} rankProbs Laya rank probabilities keyed reply_a.. (or null)
 * @param {{chat: string, latest: string, bestAction?: string}} ctx
 * @returns {{text: string, laya: number|null, score: number, flags: object[], index: number}[]}
 */
export function rankCandidates(candidates, rankProbs, ctx) {
  const rows = candidates.map((text, i) => {
    const { flags, penalty } = checkCandidate(text, ctx);
    const laya = rankProbs ? Number(rankProbs[RANK_KEYS[i]] ?? 0) : null;
    const base = laya ?? 1 / candidates.length;
    return { text, laya, score: base - penalty, flags, index: i };
  });
  return rows.sort((a, b) => b.score - a.score || a.index - b.index);
}
