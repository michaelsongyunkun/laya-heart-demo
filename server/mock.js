// Stand-in models for `npm run demo` and the browser test: the same interface as Engines, no
// model files, no Ollama. The answers are fixed functions of the chat (not model outputs) and
// the page says so. LAYA_HEART_MOCK_DELAY scales the pauses (0 = instant).
const delay = () => Number(process.env.LAYA_HEART_MOCK_DELAY ?? 1);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const wait = ms * delay();
  if (!(wait > 0)) return resolve();
  const t = setTimeout(resolve, wait);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason ?? new Error("aborted")); }, { once: true });
});

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
}

export function mockJudge() {
  return {
    name: "mock", label: "demo judge (not a model)", local: true,
    async predict(state, questions, { signal } = {}) {
      await sleep(90, signal);
      const answers = {};
      for (const [id, q] of Object.entries(questions)) {
        const h = hash(`${id}|${state}`);
        if (id === "safety") {
          answers.safety = { type: "choice", choice: "none", probabilities: { none: 0.97 } };
        } else if (q.type === "score") {
          const score = 2 + (h % 6);
          answers[id] = { type: "score", score, probabilities: { [score]: 0.6 } };
        } else {
          const keys = Object.keys(q.criteria);
          const top = keys[h % keys.length];
          const pTop = 0.55 + (h % 30) / 100;
          answers[id] = { type: "choice", choice: top,
            probabilities: Object.fromEntries(keys.map((k) => [k, k === top ? pTop : (1 - pTop) / (keys.length - 1)])) };
        }
      }
      return { answers, usage: { truncated: false }, bytesOut: 0 };
    },
  };
}

/** What the stand-in Gemma was given last (the tests check what reached the prompt). */
export const mockSeen = { draftMessages: null, prefill: null };

const REPLIES = [
  ["我在呢，刚才没顾上回你，是我不好。", "抱歉让你等了，我现在陪你好好聊聊，好吗？"],
  ["你说的我都记着，别生气啦。", "我知道你在意这个，我们现在就把它说清楚。"],
  ["好呀，就按你说的来。", "听你的，我现在就去安排，弄好了告诉你。"],
];
// When the prompt asks for English (the partner writes in English; draft/prompt.js), as the real drafter does.
const REPLIES_EN = [
  ["I'm here. Sorry I went quiet earlier, that's on me.", "Sorry I kept you waiting. I'm all yours now, want to talk?"],
  ["I remember what you told me, please don't be upset.", "I know this matters to you. Let's sort it out right now."],
  ["Sure, let's do it your way.", "You got it. I'll set it up now and tell you when it's done."],
];

export function mockDrafter() {
  return {
    name: "mock", label: "demo drafter (not a model)", local: true,
    async draft(messages, { onDelta, signal } = {}) {
      mockSeen.draftMessages = messages;
      const user = messages[messages.length - 1]?.content || "";
      const set = /replies in English/.test(user) ? REPLIES_EN : REPLIES;
      const lines = set[hash(user) % set.length];
      const text = lines.join("\n") + "\n";
      const t0 = performance.now();
      let firstTokenMs = null;
      await sleep(350, signal);
      for (let i = 2; i <= text.length; i += 2) {
        await sleep(25, signal);
        firstTokenMs ??= Math.round(performance.now() - t0);
        onDelta?.(text.slice(0, i));
      }
      onDelta?.(text);
      return { text, firstTokenMs, evalCount: text.length, promptN: 40, cacheN: 300, bytesOut: 0 };
    },
  };
}

const PICK_LABELS = [[/生日/, "生日"], [/过敏/, "过敏"], [/喜欢|讨厌/, "喜好"], [/答应|说好|约/, "约定"]];

/** Stand-in for Gemma picking what to remember: lines with a birthday, an allergy, a like or a promise. */
export function mockWriter() {
  return {
    name: "mock", local: true,
    async write(messages, { signal } = {}) {
      await sleep(150, signal);
      const said = String(messages.at(-1)?.content || "").split("\n").filter((l) => /^(TA|我)：/.test(l)).map((l) => l.slice(l.indexOf("：") + 1));
      const picks = said.flatMap((l) => {
        const hit = PICK_LABELS.find(([re]) => re.test(l));
        return hit ? [`${hit[1]}｜${l.slice(0, 30)}`] : [];
      });
      return { text: picks.slice(0, 3).join("\n") || "无", promptN: 60, cacheN: 0, evalCount: 12 };
    },
  };
}

export class MockEngines {
  constructor(settings, { notify = () => {} } = {}) {
    this.settings = settings;
    this.notify = notify;
    this.state = "ready";
  }

  snapshot() {
    const ready = this.state === "ready";
    return {
      mock: true,
      judge: { backend: "mock", status: ready ? "ready" : "idle", loadMs: 0, local: true },
      draft: { backend: "mock", planned: "mock", status: ready ? "ready" : "idle", loadMs: 0, model: "demo", local: true },
    };
  }

  backends() {
    return { judge: mockJudge(), drafter: mockDrafter(), writer: mockWriter(), cacheTag: "mock" };
  }

  async warm() {
    this.state = "ready";
    this.notify(this.snapshot());
  }

  async release() {
    this.state = "idle";
    this.notify(this.snapshot());
  }

  prefill(messages) {
    mockSeen.prefill = messages;
    return true;
  }

  dispose() {}
}
