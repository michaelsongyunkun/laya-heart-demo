// The online demo's server, in the browser tab: the same JSON API as server/http.js (routes, people,
// memory, one run at a time, NDJSON events), wired the way server/index.js wires it with --mock, so the
// page runs unchanged on the stand-in judge and drafter (server/mock.js). Settings, people and chats
// live in this tab's memory (demo/shims/fs.js); nothing leaves the browser and a reload starts over.
import { runTurn } from "../core/turn.js";
import { draftReplies } from "../core/pipeline.js";
import { clearCardCache } from "../core/cards.js";
import { prefixMessages } from "../draft/prompt.js";
import { STAGES } from "../judge/questions.js";
import { CORE_MAX, LAYERS } from "../memory/book.js";
import { ID_RE, PeopleError, PeopleStore } from "../memory/people.js";
import { memoryForTurn } from "../memory/turn.js";
import { learnFromChat } from "../memory/learn.js";
import { SettingsStore } from "../server/settings.js";
import { MockEngines } from "../server/mock.js";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_MESSAGES = 200;
const MAX_TEXT = 2000;
function cleanThread(thread) {
  if (!Array.isArray(thread)) throw new HttpError(400, "thread must be an array");
  if (thread.length > MAX_MESSAGES) throw new HttpError(413, "too many messages");
  return thread.map((m) => {
    if (!m || (m.from !== "partner" && m.from !== "me") || typeof m.text !== "string") throw new HttpError(400, "bad message");
    return { from: m.from, text: m.text.slice(0, MAX_TEXT) };
  }).filter((m) => m.text.trim());
}

const send = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export function createDemoServer({ version, lang }) {
  const home = "/demo-home";
  const settings = new SettingsStore(home);
  settings.update({ lang });
  const people = new PeopleStore(home);
  const first = people.ensureDefault(settings);
  if (!people.exists(settings.get().currentPerson)) settings.update({ currentPerson: first.id });
  const engines = new MockEngines(settings);
  const setup = null;
  let active = null;

  const enginesState = () => ({ ...engines.snapshot(), setup: setup ? setup.status() : null });
  const state = () => ({ settings: settings.get(), version, engines: enginesState() });

  /** One run's events as NDJSON; a new run (or the page going away) stops it. */
  function stream(signal, job) {
    if (active) active.abort(new Error("superseded"));
    const controller = new AbortController();
    active = controller;
    signal?.addEventListener("abort", () => controller.abort(new Error("client closed")));
    const enc = new TextEncoder();
    let out;
    const body = new ReadableStream({
      start(c) { out = c; },
      cancel() { controller.abort(new Error("client closed")); },
    });
    let ended = false;
    const emit = (type, data) => { if (!ended) out.enqueue(enc.encode(JSON.stringify({ type, data }) + "\n")); };
    job(emit, controller.signal, controller)
      .catch((e) => {
        if (controller.signal.aborted) emit("cancelled", {});
        else emit("error", { message: String(e?.message || e) });
      })
      .finally(() => {
        if (active === controller) active = null;
        ended = true;
        try { out.close(); } catch { /* already closed */ }
      });
    return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  }

  const pick = ({ id, layer, section, title, text, date }) => ({ id, layer, section, title, text, date });
  const autoView = ({ id, label, text, from, date, saidAt }) => ({ id, label, text, from, date, saidAt });
  const memorySummary = (m) => ({
    counts: m.counts, core: m.core, coreTooLong: m.coreTooLong, coreMax: CORE_MAX,
    chunks: m.chunks.filter((c) => c.source === "book").map(pick),
    auto: (m.auto || []).map(autoView),
    chat: m.chunks.filter((c) => c.layer === LAYERS.CHAT).slice(-5).map(pick),
  });
  const peopleState = () => ({ people: people.list(), current: settings.get().currentPerson, trash: people.trash() });
  const personView = (id) => ({ ...people.get(id), memory: memorySummary(people.memory(id)) });

  function prefillPerson(id) {
    if (active?.background) active.abort(new Error("superseded"));
    else if (active) return;
    if (!engines.snapshot().draft.local) return;
    const { person, thread } = people.get(id);
    engines.prefill?.(prefixMessages(thread, { stage: person.stage, core: people.memory(id).core }));
  }
  function openPerson(id) {
    const view = personView(id);
    if (settings.get().currentPerson !== id) settings.update({ currentPerson: id });
    prefillPerson(id);
    return view;
  }
  async function learnAfterTurn(personId, writer, emit, signal, run) {
    run.background = true;
    try {
      const r = await learnFromChat({ people, id: personId, writer, signal });
      if (r.saved.length) emit("memory:saved", { items: r.saved.map(autoView) });
    } catch { /* best effort, as on the real server */ }
  }

  async function api(method, pathname, body, signal) {
    const route = `${method} ${pathname}`;
    const one = /^\/api\/people\/([a-z0-9]{10})(?:\/(open|thread|delete))?$/.exec(pathname);
    if (route === "GET /api/state") return send(200, state());
    if (route === "GET /api/engines") return send(200, enginesState());
    if (route === "GET /api/setup") return send(200, { needed: false });
    if (route === "GET /api/people") return send(200, peopleState());
    if (one && !one[2] && method === "GET") return send(200, personView(one[1]));
    if (method !== "POST") throw method === "GET" ? new HttpError(404, "no such route") : new HttpError(405, "method not allowed");

    if (route === "POST /api/people") {
      const p = people.create({ name: body.name, stage: body.stage, lang: settings.get().lang });
      return send(200, openPerson(p.id));
    }
    if (one && !one[2]) {
      const person = people.update(one[1], { name: body.name, stage: body.stage, book: body.book });
      if ((body.book !== undefined || body.stage !== undefined) && settings.get().currentPerson === one[1]) prefillPerson(one[1]);
      return send(200, { person, memory: memorySummary(people.memory(one[1])) });
    }
    if (one?.[2] === "open") return send(200, openPerson(one[1]));
    if (one?.[2] === "thread") return send(200, { count: people.saveThread(one[1], body.thread) });
    if (one?.[2] === "delete") {
      people.remove(one[1]);
      if (settings.get().currentPerson === one[1]) settings.update({ currentPerson: people.ensureDefault(settings).id });
      return send(200, peopleState());
    }
    const restore = /^\/api\/trash\/([a-z0-9]{10})\/restore$/.exec(pathname);
    if (restore) {
      people.restore(restore[1]);
      return send(200, peopleState());
    }
    const forget = /^\/api\/people\/([a-z0-9]{10})\/auto\/([a-z0-9]{10})\/delete$/.exec(pathname);
    if (forget) {
      people.deleteAuto(forget[1], forget[2]);
      return send(200, { memory: memorySummary(people.memory(forget[1])) });
    }
    if (route === "POST /api/settings") {
      settings.update(body);
      return send(200, state());
    }
    if (route === "POST /api/engines/warm") {
      engines.warm().catch(() => {});
      return send(200, enginesState());
    }
    if (route === "POST /api/engines/release") {
      if (active) active.abort(new Error("released"));
      await engines.release();
      return send(200, enginesState());
    }
    if (route === "POST /api/setup/start" || route === "POST /api/setup/cancel") throw new HttpError(404, "nothing to download in the demo");
    if (route === "POST /api/forget") {
      clearCardCache();
      return send(200, { ok: true });
    }
    if (route !== "POST /api/turn" && route !== "POST /api/draft") throw new HttpError(404, "no such route");

    const s = settings.get();
    const personId = body.personId == null || body.personId === "" ? null : String(body.personId);
    if (personId && !ID_RE.test(personId)) throw new HttpError(400, "bad person id");
    const person = personId ? people.person(personId) : null;
    const thread = cleanThread(body.thread);
    if (!thread.length) throw new HttpError(400, "empty conversation");
    const stage = person?.stage ?? (Object.hasOwn(STAGES, body.stage) ? body.stage : s.stage);
    const base = { thread, lang: s.lang, thresholds: s.thresholds, adultsConfirmed: !!body.adultsConfirmed };
    const withMemory = (judge, drafter, emit) => {
      const mem = memoryForTurn({ memory: person ? people.memory(personId) : null, stage, thread,
        judgeLocal: !!judge?.local, draftLocal: !!drafter?.local });
      emit("memory", { used: mem.used, ms: mem.ms, remote: !!person && mem.remote, core: !!mem.profile.core });
      return { ...base, profile: mem.profile };
    };
    if (route === "POST /api/turn") {
      return stream(signal, async (emit, sig, run) => {
        const { judge, drafter, writer, cacheTag } = engines.backends();
        await runTurn(withMemory(judge, drafter, emit), { judge, drafter, emit, signal: sig, cacheTag });
        if (personId && settings.get().autoMemory && writer?.local && drafter?.local && !sig.aborted) {
          await learnAfterTurn(personId, writer, emit, sig, run);
        }
      });
    }
    return stream(signal, async (emit, sig) => {
      const { judge, drafter } = engines.backends();
      const card = body.card && typeof body.card === "object" ? body.card : null;
      await draftReplies({ ...withMemory(judge, drafter, emit), card }, { judge, drafter, emit, signal: sig });
    });
  }

  engines.warm().catch(() => {});

  /** fetch()-shaped entry point for /api/* requests. */
  return async function handle(url, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    try {
      let body = {};
      if (method === "POST" && init.body) {
        try { body = JSON.parse(typeof init.body === "string" ? init.body : await new Response(init.body).text()); } catch { throw new HttpError(400, "bad JSON"); }
      }
      return await api(method, url.pathname, body, init.signal);
    } catch (e) {
      return send(e instanceof HttpError || e instanceof PeopleError ? e.status : 500, { error: String(e?.message || e) });
    }
  };
}
