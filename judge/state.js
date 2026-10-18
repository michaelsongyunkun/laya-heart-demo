// ChatState: the one input every judge (Laya local, laya-serve, Jev) and the drafter share.
// A JSON object with at most the last 10 messages, chat text kept in its original language;
// speakers are "partner" / "me".
import { STAGES } from "./questions.js";

export const MAX_MESSAGES = 10;
export const MAX_MESSAGE_CHARS = 400;
export const MAX_BACKGROUND_CHARS = 200;

/**
 * @param {{from: "partner"|"me", text: string}[]} thread
 * @param {{stage?: string, background?: string}} [profile]
 * @param {{maxMessages?: number}} [opts] the judge reads the last 10; drafting passes its own window
 */
export function buildChatState(thread, profile = {}, { maxMessages = MAX_MESSAGES } = {}) {
  const messages = (thread || [])
    .filter((m) => m && (m.from === "partner" || m.from === "me") && String(m.text || "").trim())
    .slice(-Math.max(1, maxMessages))
    .map((m) => ({ from: m.from, text: String(m.text).trim().slice(0, MAX_MESSAGE_CHARS) }));
  if (!messages.length) throw new Error("empty conversation");
  const stage = STAGES[profile.stage] || STAGES.dating;
  const chat = {
    relationship: stage.state,
    messages,
    latest_from: messages[messages.length - 1].from,
  };
  const background = String(profile.background || "").trim().slice(0, MAX_BACKGROUND_CHARS);
  if (background) chat.background = background;
  return { chat };
}

/** Plain-text transcript for the drafting prompt. */
export function transcript(state, names = { partner: "对方", me: "我" }) {
  return state.chat.messages.map((m) => `${names[m.from]}：${m.text}`).join("\n");
}

const SPEAKER = { partner: "Partner", me: "Me" };

/**
 * What the judge reads: the same ChatState as plain lines ("Partner: …" / "Me: …"). Laya reads
 * "question + options + chat" once per question, and the JSON form of the state spends about
 * half its tokens on braces, quotes and keys (203 vs ~110 tokens for a 9-line chat), so this is
 * the cheapest place to save time. Fine-tune data must use this same form.
 */
export function judgeText(state) {
  const c = state.chat;
  const lines = [`Relationship: ${c.relationship}`];
  if (c.background) lines.push(`Background: ${c.background}`);
  for (const m of c.messages) lines.push(`${SPEAKER[m.from]}: ${m.text}`);
  return lines.join("\n");
}

/** All chat text in one string (used by the fact checks). */
export function chatText(state) {
  return state.chat.messages.map((m) => m.text).join("\n");
}
