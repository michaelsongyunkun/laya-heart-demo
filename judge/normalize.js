// One answer shape for every judge backend (Laya in-process, laya-serve, Jev over HTTP).
// Laya reports answer_confidence (calibrated max probability); Jev reports an
// entropy-normalized confidence. We gate on the max probability for both, so a threshold
// means the same thing whichever judge produced it.
import { LABELS } from "./questions.js";

function maxProb(probs) {
  const v = Object.values(probs || {}).map(Number).filter(Number.isFinite);
  return v.length ? Math.max(...v) : 0;
}

function expectedLevel(ans) {
  const probs = ans.probabilities || {};
  const keys = Object.keys(probs);
  if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
    return keys.reduce((s, k) => s + Number(k) * Number(probs[k]), 0);
  }
  return Number(ans.score);
}

function choiceOf(qid, ans) {
  const probs = ans.probabilities || {};
  const value = ans.choice in probs || !Object.keys(probs).length
    ? ans.choice
    : Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
  const label = LABELS[qid]?.options?.[value] || { zh: value, en: value };
  const p = Number(probs[value] ?? ans.answer_confidence ?? ans.confidence ?? 0);
  return {
    value,
    p,
    confidence: Number(ans.answer_confidence ?? maxProb(probs) ?? p),
    labelZh: label.zh,
    labelEn: label.en,
    probs,
  };
}

/** @param {Record<string, any>} answers raw `answers` object from a systemone-shaped result */
export function normalizeJudgments(answers) {
  const out = {};
  for (const [qid, ans] of Object.entries(answers || {})) {
    if (!ans || typeof ans !== "object") continue;
    if (ans.type === "score" || qid === "conflict_risk") {
      const score = expectedLevel(ans);
      out[qid] = {
        score: Number.isFinite(score) ? Math.max(0, Math.min(9, score)) : null,
        confidence: Number(ans.answer_confidence ?? maxProb(ans.probabilities)),
        probs: ans.probabilities || {},
      };
    } else if (ans.type === "noul") {
      const p = Number(ans.noul);
      out[qid] = { value: p >= 0.5 ? "yes" : "no", p: p >= 0.5 ? p : 1 - p, confidence: Math.abs(p - 0.5) * 2, probs: { yes: p, no: 1 - p } };
    } else {
      out[qid] = choiceOf(qid, ans);
    }
  }
  return out;
}
