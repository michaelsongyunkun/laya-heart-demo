// Which 1–3 bank questions a partner turn gets. Plain rules over the words just said (and the
// previous card), so picking costs nothing and the same chat always gets the same card.
// The rules are a first cut for the look and speed; which questions are worth asking where
// is something the fine-tune data and the benchmark should settle later.
import { MAX_QUOTE_CHARS, dangerLevel } from "./bank.js";

const PUNCT = /[\s。.!！?？…~～,，、]/g;
const QUESTION = /[?？]\s*$|[吗嘛][。.!！]?$|是不是|有没有|记不记得|还记得|知不知道|为什么|为啥|干嘛|(?:你|这是)什么意思|啥意思|怎么了/;
const DEMAND = /^(?:那你说|你说啊|你说吧|说吧|说啊|你倒是说|快说|说来听听)/;
const SO_WHAT = /^(?:所以呢|然后呢|那又怎样|那又怎么样|那怎么办|所以)[?？。.!！]*$/;
const SOFTEN = /这还差不多|算你识相|这还像话|原谅你|下不为例|勉强原谅|饶了你|看你表现|知道就好|好吧|行吧|嗯嗯|好呀|好啊|哈哈/;
const WARNING = /你最好是|你最好|你等着|你看着办|再有下次|下次再这样|别让我失望/;
const FINE = /没事|随便|都行|你忙吧|算了|呵呵|无所谓/;
const TEASE = /哼|讨厌|人家|嘻嘻|嘿嘿|坏蛋|亲亲|抱抱|😏|😘|🥺|😚|❤|♥/u;
const MEMORY = /忘|记得|记不记得|说过|答应过|什么日子|纪念日|生日/;

const bare = (s) => String(s || "").replace(PUNCT, "");

/** Indices of the last message of each partner turn (a card hangs under each). */
export function cardTargets(messages) {
  const out = [];
  (messages || []).forEach((m, i) => {
    if (m?.from === "partner" && (i === messages.length - 1 || messages[i + 1]?.from !== "partner")) out.push(i);
  });
  return out;
}

/** The partner's words, as quoted in a question, or null when too long to quote. */
export function quoteOf(text) {
  const t = String(text || "").trim().replace(/[。.!！~～]+$/, "");
  return t && [...t].length <= MAX_QUOTE_CHARS ? t : null;
}

/** Was the previous card tense? (keeps "嗯" after a fight from reading as small talk) */
function tense(prev) {
  if (!prev?.items) return false;
  const it = (id) => prev.items.find((x) => x.id === id);
  const danger = it("danger");
  if (danger && dangerLevel(danger.score) >= 7) return true;
  return [["emergency", "yes"], ["means_ok", "no"], ["means_trust", "no"], ["resolved", "no"]]
    .some(([id, v]) => it(id)?.top === v && it(id).p >= 0.6);
}

/**
 * @param {{from: string, text: string}[]} messages the thread
 * @param {number} idx index of the partner message the card is for
 * @param {object|null} prev the card of the previous partner turn, if known
 * @returns {{id: string, quote?: string|null}[]}
 */
export function pickQuestions(messages, idx, prev = null) {
  const latest = String(messages[idx]?.text || "").trim();
  const recent = messages.slice(Math.max(0, idx - 3), idx + 1).map((m) => m.text).join("\n");
  const short = [...bare(latest)].length <= 5;
  const quote = quoteOf(latest);
  const question = QUESTION.test(latest);

  if (SOFTEN.test(latest) && !question) return [{ id: "resolved" }];
  if (SO_WHAT.test(latest)) return [{ id: "need" }];
  if (DEMAND.test(latest)) return [{ id: "answer_now" }, { id: MEMORY.test(recent) ? "best_action_memory" : "best_action" }];
  if (WARNING.test(latest) && quote) return [{ id: "means_trust", quote }, { id: "emergency" }];
  if (FINE.test(latest) && quote) return [{ id: "means_ok", quote }, { id: "danger" }];
  if (question) return [{ id: "literal", quote }, { id: "intent" }, { id: "danger" }];
  if (TEASE.test(latest)) return [{ id: "tease" }, { id: "intent" }];
  if (short && quote && tense(prev)) return [{ id: "means_trust", quote }, { id: "emergency" }];
  return [...bare(latest)].length >= 15
    ? [{ id: "intent" }, { id: "danger" }, { id: "need" }]
    : [{ id: "intent" }, { id: "danger" }];
}
