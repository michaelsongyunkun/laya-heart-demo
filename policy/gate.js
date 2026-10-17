// Confidence gate + safety routing. Pure code: decides how the drafts should be written and
// which notices the panel shows. Thresholds are starting values, not tuned numbers; they
// move to per-question calibrated thresholds once the fine-tuned Laya has a dev set.
import { keywordSignal } from "./safety.js";

export const DEFAULT_THRESHOLDS = {
  uncertain: 0.45, // intent / best_action max probability below this => "not sure"
  safetyModel: 0.8, // Laya safety (non-"none") counts only at or above this
};

/**
 * @param {object} j normalized judgments (may be null if the judge failed)
 * @param {string} chat all chat text
 * @returns {{mode: "normal"|"uncertain"|"safety", safety: string|null,
 *   safetySource: string|null, blockDraft: boolean, notices: object[]}}
 */
export function decidePolicy(j, chat, thresholds = DEFAULT_THRESHOLDS) {
  const notices = [];
  let safety = null;
  let safetySource = null;

  const kw = keywordSignal(chat);
  if (kw) {
    safety = kw.kind;
    safetySource = "keyword";
  } else if (j?.safety && j.safety.value !== "none" && j.safety.p >= thresholds.safetyModel) {
    safety = j.safety.value;
    safetySource = "laya";
  }
  if (safety) notices.push({ kind: "safety", safety, source: safetySource });

  let mode = safety ? "safety" : "normal";
  if (!j) {
    notices.push({ kind: "judge_unavailable" });
  } else if (!safety) {
    const weak = ["intent", "best_action"].filter((q) => j[q] && j[q].p < thresholds.uncertain);
    if (weak.length) {
      mode = "uncertain";
      notices.push({ kind: "uncertain", questions: weak });
    }
  }
  // Possible minor: stop drafting until the user confirms both people are adults.
  const blockDraft = safety === "minor";
  return { mode, safety, safetySource, blockDraft, notices };
}

/**
 * The same rules for a per-message card (core/cards.js): keywords or Laya's hidden safety
 * question (only when confident) raise a safety notice; a multi-option question whose top
 * answer is weak makes the drafts neutral.
 * @param {{items: object[], safety?: {value: string, p: number}}|null} card
 * @param {string} chat all chat text
 */
export function cardPolicy(card, chat, thresholds = DEFAULT_THRESHOLDS) {
  const notices = [];
  let safety = null;
  let safetySource = null;
  const kw = keywordSignal(chat);
  if (kw) {
    safety = kw.kind;
    safetySource = "keyword";
  } else if (card?.safety && card.safety.value !== "none" && card.safety.p >= thresholds.safetyModel) {
    safety = card.safety.value;
    safetySource = "laya";
  }
  if (safety) notices.push({ kind: "safety", safety, source: safetySource, p: safetySource === "laya" ? card.safety.p : null });

  let mode = safety ? "safety" : "normal";
  if (!card) {
    notices.push({ kind: "judge_unavailable" });
  } else if (!safety) {
    const weak = card.items
      .filter((i) => i.type === "choice" && i.options.length >= 3 && i.p < thresholds.uncertain)
      .map((i) => i.id);
    if (weak.length) {
      mode = "uncertain";
      notices.push({ kind: "uncertain", questions: weak });
    }
  }
  return { mode, safety, safetySource, blockDraft: safety === "minor", notices };
}
