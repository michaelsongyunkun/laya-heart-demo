// Laya-Heart, local web page. Plain DOM, no framework, no build step; every area renders from
// the state `S`. The server runs the models; each run streams back as NDJSON (server/http.js).
//
// The flow: copy what they said in your chat app, come back, press Ctrl+V anywhere on the page.
// The message is added, Laya's card hangs under it within a second, and two replies are written
// at once on the right. Click one to copy it; you send it yourself.
// Each person you chat with has a profile: their chat (saved on this PC) and a book you write
// about them, which the server cuts into a layered memory (memory/, docs/design/spec-people-memory.md).
import { t, setLang, getLang, HEAT_LEVELS } from "./i18n.js";
import { EXAMPLES } from "./examples.js";
import { STAGES } from "../judge/questions.js";
import { dangerLevel } from "../judge/bank.js";
import { cardTargets } from "../judge/select.js";
import { parseChatText } from "../core/clipboard_parse.js";
import { cleanLine, isPreamble } from "../draft/parse.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const PASTE_KEY = IS_MAC ? "⌘V" : "Ctrl+V";
const N_REPLIES = 2;

const S = {
  settings: null,
  engines: null,
  version: "",
  thread: [],
  composer: { partner: "", me: "" }, // what is typed in the two boxes, kept across re-renders
  cards: new Map(), // thread index -> Laya card
  pending: new Map(), // thread index -> {questions, items} of a card being asked
  shownCards: new Set(), // message ids whose card is on screen (it rises in once)
  openCards: new Set(), // message ids of older cards opened again (the latest is always open, the rest fold)
  shownReplies: new Set(), // replies already on screen in this turn (they rise in once, not on every redraw)
  turn: null, // the run in progress or last finished: cards + replies
  used: null, // the reply last put into the 我说 box (its button says so)
  lastCopied: "",
  serverDown: false, // the local server did not answer the last request
  view: "main", // main | settings | person | consent
  people: [], // [{id, name, stage, updatedAt}], the last changed first
  trash: [], // [{id, name, deletedAt}]: deleted people, restorable for 30 days
  personId: null, // whose chat this is
  person: null, // {person, book, memory} of personId
  scratch: null, // {stage} while an example is shown: nothing is saved, no one's memory is used
  bookDraft: null, // the book as typed in the profile, until it is saved
};

// ---------------- helpers ----------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style") for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, String(sv));
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = (id) => document.getElementById(id);
/** replaceChildren that skips null/false (it would print them as the text "null"). */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const uid = () => Math.random().toString(36).slice(2, 10);
const pct = (p) => `${Math.round((Number(p) || 0) * 100)}%`;
const secs = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`);
const L = (obj) => (obj ? obj[getLang()] ?? obj.zh : "");
const fmtBytes = (n) => (!n ? "0 B" : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const fmtSize = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const plain = (thread) => thread.map(({ from, text }) => ({ from, text }));

/** A string whose {key} is the paste shortcut, with the shortcut drawn as a key. */
const KEY_MARK = "@@KEY@@";
function withKey(name) {
  const [before, after = ""] = t(name, { key: KEY_MARK }).split(KEY_MARK);
  return [before, h("kbd", null, PASTE_KEY), after];
}

/** One or two letters for a person's avatar ("小雨" -> "雨", "TA" -> "TA", "Alex" -> "A"). */
function initial(name) {
  const chars = [...String(name || "").trim()];
  if (!chars.length) return "·";
  if (/^[A-Za-z]+$/.test(chars.join("")) && chars.length <= 2) return chars.join("").toUpperCase();
  if (/[A-Za-z]/.test(chars[0])) return chars[0].toUpperCase();
  return chars.length > 1 && /[小老阿]/.test(chars[0]) ? chars[1] : chars[0];
}

function icon(name) {
  const paths = {
    gear: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.1 4.6-.1-1.1 2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.9-1.1L15.3 4h-4l-.4 2.6a8 8 0 0 0-1.9 1.1l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.2l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.9 1.1l.4 2.6h4l.4-2.6a8 8 0 0 0 1.9-1.1l2.4 1 2-3.4-2-1.6.1-1.1Z",
    back: "M15 5l-7 7 7 7",
    x: "M6 6l12 12M18 6 6 18",
    shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3Z",
    alert: "M12 3 2 20h20L12 3Zm0 6v5m0 3v.5",
    copy: "M9 9h10v11H9zM5 15V4h10",
    pen: "M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4",
    redo: "M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5",
    book: "M5 4h9a4 4 0 0 1 4 4v12H8a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h10",
    swap: "M7 4 3 8l4 4M3 8h13M17 12l4 4-4 4M21 16H8",
    spark: "M12 3.5l1.9 5.4 5.6 1.9-5.6 1.9L12 18.1l-1.9-5.4-5.6-1.9 5.6-1.9L12 3.5Z",
    chev: "M6 9l6 6 6-6",
    check: "M5 12.5l4.2 4.2L19 7",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ico");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", paths[name]);
  svg.append(p);
  return svg;
}

let toastTimer = null;
function toast(text, action) {
  const el = $("toast");
  fill(el, h("span", null, text),
    ...(action ? [h("button", { class: "toast-action", onclick: () => { action.run(); el.classList.remove("is-on"); } }, action.label)] : []));
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), action ? 5000 : 2600);
}

// ---------------- server ----------------
// The page lives as long as the browser tab; the server only while `npm start` runs. When the
// server is gone, fetch() only says "Failed to fetch": say what happened and how to get it back,
// keep the chat, and pick up again by itself once the server answers.
const SERVER_DOWN = "SERVER_DOWN";

async function request(path, init = {}) {
  try {
    const res = await fetch(path, init);
    markServer(true);
    return res;
  } catch (e) {
    if (init.signal?.aborted) throw e;
    markServer(false);
    throw new Error(SERVER_DOWN);
  }
}

function markServer(up) {
  if (S.serverDown === !up) return;
  S.serverDown = !up;
  if (S.settings) renderBanner();
  if (!up) watchServer();
}

let serverPoll = null;
function watchServer(delay = 2000) {
  clearTimeout(serverPoll);
  serverPoll = setTimeout(async () => {
    try {
      const res = await fetch("/api/engines");
      if (!res.ok) throw new Error(String(res.status));
      S.engines = await res.json();
      markServer(true);
      renderHeader();
      renderBanner();
      watchEngines();
      flushThreadSave(); // a change made while it was gone
    } catch {
      watchServer(2000);
    }
  }, delay);
}

async function api(path, body) {
  const res = await request(path, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** POST, then call onEvent(type, data) for each NDJSON line until the run ends. */
async function stream(path, body, onEvent, signal) {
  const res = await request(path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (signal?.aborted) throw e;
      markServer(false); // the server went away in the middle of a run
      throw new Error(SERVER_DOWN);
    }
    const { value, done } = chunk;
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) {
        const ev = JSON.parse(line);
        onEvent(ev.type, ev.data);
      }
    }
  }
}

async function save(patch) {
  const st = await api("/api/settings", patch);
  S.settings = st.settings;
  S.engines = st.engines;
  return st;
}

let enginePoll = null;
function watchEngines() {
  clearTimeout(enginePoll);
  const busy = () => [S.engines?.judge?.status, S.engines?.draft?.status].includes("loading") || !!S.engines?.setup?.running;
  const tick = async () => {
    try {
      const wasDownloading = !!S.engines?.setup?.running;
      S.engines = await api("/api/engines");
      if (wasDownloading && !S.engines.setup?.running && !S.engines.setup?.needed) toast(t("setupDone"));
      renderHeader();
      renderBanner();
      if (S.view === "settings") renderSheet();
    } catch { /* server gone; the next action reports it */ }
    if (busy()) enginePoll = setTimeout(tick, 700);
  };
  enginePoll = setTimeout(tick, 300);
}

// ---------------- header + banner ----------------
function privacy() {
  const e = S.engines;
  const out = [e && e.judge && !e.judge.local && t("privacyJudge"), e && e.draft && !e.draft.local && t("privacyDraft")].filter(Boolean);
  const bytes = S.turn?.metrics?.bytesOut ?? 0;
  // Tracing (server/tracing.js, off unless the server was started with it): numbers only, but
  // to Sentry they leave the machine, so the header says so.
  const tr = e?.tracing?.on ? e.tracing.to : null;
  if (!out.length && tr === "sentry") return { local: false, text: t("privacyTracing") };
  if (!out.length) return { local: true, text: t("privacyLocal", { bytes: fmtBytes(bytes) }) + (tr === "spotlight" ? t("privacySpotlight") : "") };
  return { local: false, text: t("privacyRemote", { what: out.join(" + ") }) };
}

function engineDot(label, st) {
  const status = st?.status || "idle";
  const tip = status === "ready" && st.loadMs != null ? t("readyIn", { s: (st.loadMs / 1000).toFixed(1) })
    : status === "error" ? String(st.error || "") : t(`st_${status}`);
  return h("span", { class: `eng is-${status}`, title: `${label}: ${tip}` }, h("i", { "aria-hidden": "true" }), label);
}

function renderHeader() {
  const p = privacy();
  const e = S.engines;
  fill($("hdr"),
    h("div", { class: "brand" },
      h("span", { class: "brand-mark", "aria-hidden": "true" }),
      h("span", { class: "brand-name" }, "Laya", h("em", null, "Heart"))),
    e?.mock ? h("span", { class: "tag is-demo" }, t("demoBadge")) : null,
    h("div", { class: "status" },
      h("span", { class: `privacy ${p.local ? "is-local" : "is-remote"}`, title: `${p.text}\n${t("footer")}` },
        icon("shield"), h("span", { class: "privacy-text" }, p.text)),
      h("span", { class: "sep", "aria-hidden": "true" }),
      h("span", { class: "engines", "aria-label": t("sEngines") },
        engineDot(t("engLaya"), e?.judge), engineDot(t("engGemma"), e?.draft))),
    h("button", { class: "icon-btn", title: t("settings"), "aria-label": t("settings"), onclick: () => openSheet("settings") }, icon("gear")),
  );
}

function errText(msg) {
  const m = String(msg || "");
  if (m === SERVER_DOWN) return t("errServerDown");
  if (m.startsWith("LLAMA_SERVER_MISSING")) return t("errLlamaMissing");
  if (m.startsWith("DRAFT_MODEL_MISSING") || m.startsWith("OLLAMA_MODEL_MISSING")) return t("errDraftModelMissing", { model: m.split(" ")[1] || "" });
  if (m.startsWith("OLLAMA_UNREACHABLE")) return t("errOllamaDown", { base: m.split(" ")[1] || "" });
  if (m.startsWith("LAYA_MODEL_MISSING")) return t("errLayaMissing");
  return m;
}

function renderBanner() {
  const e = S.engines;
  const items = [];
  const note = $("tuned-note"); // models just downloaded or switched in settings
  if (note) note.textContent = tunedNote(e);
  const refocus = document.activeElement?.id === "setup-btn"; // the card is redrawn on every poll
  if (S.serverDown) {
    items.push(h("div", { class: "banner is-warn", role: "alert" }, t("bannerServerDown"),
      h("button", { class: "link", onclick: () => watchServer(0) }, t("retry"))));
  } else if (e && S.settings?.consentAccepted) {
    // A model still to be downloaded shows in the download card, not as an error.
    const setup = e.setup;
    const pending = new Set((setup?.items || []).filter((i) => !SETUP_DONE.has(i.state)).map((i) => i.id));
    if (setup && (setup.needed || setup.running)) items.push(setupCard(setup));
    if (!e.mock) { // stand-in models have nothing to report
      if (!pending.has("laya")) {
        const unsupported = setup?.items?.some((i) => i.id === "laya" && i.state === "unsupported");
        if (e.judge.status === "missing") items.push(h("div", { class: unsupported ? "banner" : "banner is-warn" }, t(unsupported ? "bannerLayaUnsupported" : "bannerLayaMissing")));
        else if (e.judge.status === "error") items.push(h("div", { class: "banner is-warn" }, t("runError", { msg: errText(e.judge.error) })));
      }
      if (e.draft.status === "error" && !pending.has("llama") && !pending.has("gemma")) {
        items.push(h("div", { class: "banner is-warn" }, t("bannerDraftError", { msg: errText(e.draft.error) }),
          h("button", { class: "link", onclick: () => openSheet("settings") }, t("settings"))));
      }
      if ([e.judge.status, e.draft.status].includes("loading")) items.push(h("div", { class: "banner" }, h("span", { class: "pulse-dot", "aria-hidden": "true" }), t("bannerLoading")));
    }
  }
  fill($("banner"), ...items);
  if (refocus) $("setup-btn")?.focus();
}

// ---------------- first start: downloading the models (setup/, server side) ----------------
const SETUP_DONE = new Set(["ready", "off", "unsupported"]);
const setupRate = { id: null, bytes: 0, at: 0, bps: 0 }; // download speed, smoothed over the polls

function setupSpeed(item) {
  const now = performance.now();
  if (setupRate.id !== item.id || item.bytes < setupRate.bytes) {
    Object.assign(setupRate, { id: item.id, bytes: item.bytes, at: now, bps: 0 });
  } else if (item.bytes === setupRate.bytes && !setupRate.bps) {
    setupRate.at = now; // not moving yet: time it from when it does
  } else if (now - setupRate.at >= 500) {
    const bps = ((item.bytes - setupRate.bytes) * 1000) / (now - setupRate.at);
    setupRate.bps = setupRate.bps ? setupRate.bps * 0.7 + bps * 0.3 : bps;
    Object.assign(setupRate, { bytes: item.bytes, at: now });
  }
  return setupRate.bps;
}

function setupStateText(item, st) {
  const p = Math.floor((100 * item.bytes) / Math.max(1, item.total));
  switch (item.state) {
    case "ready": return t(item.from && item.from !== "download" ? `setupFrom_${item.from}` : "setupReady");
    case "unsupported": return t(`setupUnsupported_${item.id}`);
    case "waiting": return t("setupWaiting");
    case "checking": return t("setupChecking", { p });
    case "extracting": return t("setupExtracting");
    case "downloading": {
      const bps = setupSpeed(item);
      return [t("setupDownloading", { p }), bps > 0 ? `${(bps / 1e6).toFixed(1)} MB/s` : null,
        bps > 0 ? t("setupEta", { min: Math.max(1, Math.ceil(st.remainingBytes / bps / 60)) }) : null].filter(Boolean).join(" · ");
    }
    case "error":
      if (item.error === "BAD_HASH") return t("setupErr_BAD_HASH");
      if (["HTTP", "NETWORK", "TIMEOUT", "SHORT"].includes(item.error)) return t("setupErr_net");
      if (item.error === "DISK" || item.error === "EXTRACT") return t(`setupErr_${item.error}`, { msg: item.message || "" });
      return t("setupErr", { msg: item.message || item.error });
    default: return item.bytes > 0 ? t("setupPartial", { p }) : t("setupMissing");
  }
}

function setupCard(st) {
  const rows = st.items.filter((i) => i.state !== "off").map((i) => h("li", { class: `setup-row is-${i.state}` },
    h("span", { class: "setup-name" }, t(`setup_${i.id}`)),
    h("span", { class: "mono dim" }, fmtSize(i.total)),
    h("span", { class: "setup-state" }, setupStateText(i, st)),
    SETUP_DONE.has(i.state) ? null
      : h("span", { class: "setup-meter", "aria-hidden": "true", style: { "--p": Math.min(1, i.bytes / Math.max(1, i.total)) } }, h("i"))));
  const short = st.error?.code === "NO_SPACE" ? st.error
    : st.freeBytes != null && st.freeBytes < st.remainingBytes + 3e8 ? { need: st.remainingBytes + 3e8, free: st.freeBytes } : null;
  const started = st.items.some((i) => i.bytes > 0 && !SETUP_DONE.has(i.state));
  const label = st.items.some((i) => i.state === "error") ? "setupRetry" : started ? "setupResume" : "setupStart";
  return h("section", { class: "setup", "aria-label": t("setupTitle") },
    h("h3", null, t("setupTitle")),
    h("p", null, t("setupWhat", { size: fmtSize(st.remainingBytes), home: st.home })),
    h("p", { class: "fine" }, t("setupHosts")),
    h("ul", { class: "setup-list" }, rows),
    st.vcRuntime ? h("p", { class: "fine is-warn" }, t("setupVc"), " ",
      h("a", { href: st.vcRuntime.url, target: "_blank", rel: "noopener noreferrer" }, t("setupVcLink"))) : null,
    short && !st.running ? h("p", { class: "fine is-warn" }, t("setupNoSpace", { need: fmtSize(short.need), free: fmtSize(short.free) })) : null,
    h("div", { class: "inline" },
      st.running
        ? h("button", { class: "ghost", id: "setup-btn", onclick: () => setupAction("cancel") }, t("setupPause"))
        : h("button", { class: "primary", id: "setup-btn", disabled: !!short, onclick: () => setupAction("start") }, t(label)),
      st.freeBytes != null ? h("span", { class: "fine" }, t("setupFree", { free: fmtSize(st.freeBytes) })) : null));
}

async function setupAction(what) {
  try {
    S.engines = { ...S.engines, setup: await api(`/api/setup/${what}`, {}) };
  } catch (e) {
    toast(errText(e.message));
  }
  renderBanner();
  watchEngines();
}

// ---------------- people ----------------
// The chat shown is one person's. It is saved a moment after each change (one write for a burst
// of changes) and before anything else is opened; an example is never saved.
const SEND_MAX = 60; // newest lines sent with a run (Gemma reads up to 16, Laya 10; older cards come from these)
let saveTimer = null;
let pendingSave = null;

async function loadPeople() {
  const st = await api("/api/people");
  S.people = st.people;
  S.trash = st.trash;
  return st;
}

function resetTurnState() {
  S.cards = new Map();
  S.pending = new Map();
  S.shownCards = new Set();
  S.openCards = new Set();
  S.turn = null;
  S.used = null;
}

/** A person's view from the server ({person, book, thread, memory}) becomes what is shown. */
function showPerson(view) {
  S.personId = view.person.id;
  S.person = { person: view.person, book: view.book, memory: view.memory };
  S.scratch = null;
  S.bookDraft = null;
  S.thread = view.thread.map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at ?? null }));
  resetTurnState();
}

async function openPerson(id) {
  stopTurn();
  await flushThreadSave();
  showPerson(await api(`/api/people/${id}/open`, {}));
  await loadPeople();
  renderConvo();
  renderReplies();
}

async function newPerson() {
  stopTurn();
  await flushThreadSave();
  showPerson(await api("/api/people", { name: t("newPersonName"), stage: S.person?.person.stage ?? "dating" }));
  await loadPeople();
  renderConvo();
  renderReplies();
  openSheet("person");
}

/** The chat changed: save it shortly. */
function saveThreadSoon() {
  if (S.scratch || !S.personId) return;
  pendingSave = { id: S.personId, thread: S.thread.map(({ id, from, text, at }) => ({ id, from, text, at })) };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushThreadSave, 300);
}

async function flushThreadSave() {
  clearTimeout(saveTimer);
  const job = pendingSave;
  pendingSave = null;
  if (!job) return;
  try {
    await api(`/api/people/${job.id}/thread`, { thread: job.thread });
  } catch {
    pendingSave ??= job; // tried again with the next change, or when the server is back
  }
}

async function renamePerson(name) {
  const id = S.personId;
  const r = await api(`/api/people/${id}`, { name });
  if (S.personId !== id) return;
  S.person.person = r.person;
  await loadPeople();
  const title = document.querySelector("#sheet .sheet-head h2");
  if (title && S.view === "person") title.textContent = t("profileTitle", { name: r.person.name });
  flashSaved();
  renderConvo();
}

async function saveBook(text) {
  const id = S.personId;
  const r = await api(`/api/people/${id}`, { book: text });
  if (S.personId !== id) return;
  S.person = { person: r.person, book: text, memory: r.memory };
  S.bookDraft = null;
  await loadPeople();
  if (S.view === "person") renderSheet();
  flashSaved();
}

async function setStage(stage) {
  if (S.scratch) S.scratch.stage = stage;
  else {
    const r = await api(`/api/people/${S.personId}`, { stage });
    S.person.person = r.person;
    await loadPeople();
  }
  if (S.thread.length) startTurn();
}

async function deletePerson() {
  if (!window.confirm(t("confirmDelete", { name: S.person.person.name }))) return;
  stopTurn();
  await flushThreadSave(); // the trash keeps the whole chat
  S.bookDraft = null;
  const st = await api(`/api/people/${S.personId}/delete`, {});
  closeSheet();
  await openPerson(st.current);
  toast(t("toastDeleted"));
}

async function restorePerson(item) {
  const st = await api(`/api/trash/${item.id}/restore`, {});
  S.people = st.people;
  S.trash = st.trash;
  toast(t("toastRestored", { name: item.name }));
  renderSheet();
  renderConvo();
}

// ---------------- conversation ----------------
function renderConvo() {
  const stage = S.scratch ? S.scratch.stage : S.person?.person.stage ?? "dating";
  const stageSel = h("select", {
    class: "stage", "aria-label": t("stage"), title: t("stage"),
    onchange: (ev) => setStage(ev.target.value),
  }, Object.entries(STAGES).map(([k, v]) => h("option", { value: k, selected: k === stage }, L(v))));

  // Whose chat this is: the people, a new one, or one of the examples (shown, never saved).
  const personSel = h("select", {
    class: "person-sel", "aria-label": t("person"),
    onchange: (ev) => {
      const v = ev.target.value;
      if (v === "__new") newPerson();
      else if (v.startsWith("ex:")) loadExample(EXAMPLES.find((x) => `ex:${x.id}` === v));
      else openPerson(v);
    },
  },
  S.people.map((p) => h("option", { value: p.id, selected: !S.scratch && p.id === S.personId }, p.name)),
  h("option", { value: "__new" }, t("newPerson")),
  h("optgroup", { label: t("exampleMode") },
    EXAMPLES.map((ex) => h("option", { value: `ex:${ex.id}`, selected: S.scratch?.exampleId === ex.id }, L(ex)))));

  // Re-rendering replaces the two text boxes: keep the caret where it was.
  const active = document.activeElement;
  const caret = active?.id?.startsWith("composer-") ? { id: active.id, a: active.selectionStart, b: active.selectionEnd } : null;

  $("convo").setAttribute("aria-label", t("convoTitle"));
  fill($("convo"),
    h("div", { class: "chat-head" },
      S.scratch ? h("span", { class: "avatar is-example", "aria-hidden": "true" }, icon("spark"))
        : h("span", { class: "avatar", "aria-hidden": "true" }, initial(S.person?.person.name)),
      personSel,
      stageSel,
      h("span", { class: "grow" }),
      S.scratch ? [h("span", { class: "tag" }, t("exampleNotSaved")),
        h("button", { class: "ghost", onclick: () => openPerson(S.personId) }, t("leaveExample"))]
        : h("button", { class: "ghost", onclick: () => openSheet("person"), disabled: !S.person }, icon("book"), t("profileBtn"))),
    h("div", { id: "thread", class: "thread", "aria-live": "polite" }),
    h("div", { class: "composers" }, composerEl("partner"), composerEl("me")),
  );
  if (caret) {
    const el = $(caret.id);
    el?.focus();
    el?.setSelectionRange(caret.a, caret.b);
  }
  renderThread();
}

/** One of the two boxes: what they said (Enter: Laya reads it, replies follow) or what I said
 *  (Enter: it is only added to the chat; nothing is analysed). Its button lights up once there
 *  is something in the box. */
function composerEl(who) {
  const them = who === "partner";
  const id = `composer-${who}`;
  const box = h("div", { class: `composer is-${who}${S.composer[who].trim() ? " has-text" : ""}` },
    h("div", { class: "composer-top" },
      h("label", { class: `speaker is-${who}`, for: id }, them ? t("speakerThem") : t("speakerMe")),
      them ? h("span", { class: "paste-hint" }, withKey("pasteHint")) : null),
    h("textarea", {
      id, rows: "2", value: S.composer[who],
      placeholder: them ? t("inputPlaceholderThem") : t("inputPlaceholderMe"),
      oninput: (ev) => {
        S.composer[who] = ev.target.value;
        box.classList.toggle("has-text", !!ev.target.value.trim());
      },
      onkeydown: (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.isComposing) {
          ev.preventDefault();
          addFromComposer(who);
        }
      },
    }),
    h("button", { class: "add", onclick: () => addFromComposer(who) }, them ? t("addThem") : t("addMe")));
  return box;
}

function lastTarget() {
  const targets = cardTargets(S.thread);
  return targets.length ? targets[targets.length - 1] : null;
}

function latestCard() {
  const i = lastTarget();
  return i == null ? null : S.cards.get(i) || null;
}

/** keepScroll: an older card was opened or folded, so stay where the reader is (otherwise the
 *  chat follows its newest line). */
function renderThread({ keepScroll = false } = {}) {
  const box = $("thread");
  if (!box) return;
  const top = box.scrollTop;
  box.classList.toggle("is-empty", !S.thread.length);
  if (!S.thread.length) {
    fill(box, h("div", { class: "hello" },
      h("span", { class: "hello-mark", "aria-hidden": "true" }),
      h("p", { class: "hello-title" }, t("emptyTitle")),
      h("ol", { class: "hello-steps" },
        h("li", null, t("emptyStep1")),
        h("li", null, withKey("emptyStep2")),
        h("li", null, t("emptyStep3"))),
      h("div", { class: "examples" },
        h("span", null, t("tryExample")),
        EXAMPLES.map((ex) => h("button", { class: "chip", onclick: () => loadExample(ex) }, L(ex))))));
    return;
  }
  const latest = lastTarget();
  const cardFor = (m, i) => {
    const el = S.cards.has(i) ? cardEl(S.cards.get(i), i === latest, m.id) : S.pending.has(i) ? pendingCardEl(S.pending.get(i)) : null;
    if (el && S.shownCards.has(m.id)) el.classList.add("is-settled");
    else if (el) S.shownCards.add(m.id);
    return el;
  };
  // tabindex -1: a tap on a phone focuses the bubble, which shows its two buttons
  fill(box, ...S.thread.flatMap((m, i) => [
    h("div", { class: `bubble is-${m.from}`, dataset: { id: m.id }, tabindex: "-1" },
      h("span", { class: "sr-only" }, `${m.from === "partner" ? t("them") : t("me")}：`),
      h("p", null, m.text),
      h("span", { class: "bubble-tools" },
        h("button", {
          class: "tool flip", title: t("flipSpeaker"), "aria-label": t("flipSpeaker"),
          onclick: () => { m.from = m.from === "partner" ? "me" : "partner"; threadChanged(); },
        }, icon("swap")),
        h("button", {
          class: "tool del", title: t("remove"), "aria-label": t("remove"),
          onclick: () => { S.thread = S.thread.filter((x) => x.id !== m.id); threadChanged(); },
        }, icon("x")))),
    cardFor(m, i),
  ].filter(Boolean)));
  box.scrollTop = keepScroll ? top : box.scrollHeight;
}

/** A line was removed or flipped: indices moved, so the cards are rebuilt (the server's cache
 *  brings back the ones it has seen at once). */
function threadChanged() {
  stopTurn();
  saveThreadSoon();
  S.cards = new Map();
  S.pending = new Map();
  S.shownCards = new Set();
  S.turn = null;
  renderConvo();
  renderReplies();
  if (cardTargets(S.thread).length) startTurn();
}

/** 对方说: their line, then a turn. 我说: what I send — it is copied (so it can be pasted in the
 *  chat app) and added to the chat; undo takes it out and puts it back in the box. */
async function addFromComposer(who) {
  const text = S.composer[who].trim();
  if (!text) return;
  S.composer[who] = "";
  $(`composer-${who}`).value = "";
  if (who === "partner") {
    addMessages([{ from: "partner", text }]);
    $("composer-partner")?.focus();
    return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
    S.lastCopied = text;
  } catch { /* said in the toast */ }
  const msg = { id: uid(), from: "me", text, at: Date.now() };
  S.thread.push(msg);
  saveThreadSoon();
  S.used = null;
  renderConvo();
  renderReplies();
  $("composer-me")?.focus();
  toast(copied ? t("toastCopiedAdded") : t("toastAddedNotCopied"), {
    label: t("undo"),
    run: () => {
      S.thread = S.thread.filter((m) => m.id !== msg.id);
      saveThreadSoon();
      S.composer.me = text;
      renderConvo();
      $("composer-me")?.focus();
    },
  });
}

/** "用这条": the reply goes into the 我说 box to be edited; nothing is copied or added yet. */
function useReply(text) {
  S.composer.me = text;
  S.used = text;
  const el = $("composer-me");
  if (el) {
    el.value = text;
    el.focus();
    el.setSelectionRange(text.length, text.length);
    const box = el.closest(".composer");
    box?.classList.toggle("has-text", !!text.trim());
    box?.classList.remove("is-flash");
    void box?.offsetWidth; // restart the highlight
    box?.classList.add("is-flash");
  }
  toast(t("toastUsed"));
  renderReplies();
}

/** Append messages; a new line from them starts a turn (card, then replies). */
function addMessages(msgs) {
  if (!msgs.length) return;
  const at = Date.now();
  for (const m of msgs) S.thread.push({ id: uid(), at, ...m });
  saveThreadSoon();
  renderConvo();
  if (msgs.some((m) => m.from === "partner")) startTurn();
}

/** The whole chat with this person goes (it is saved, so ask first); their profile and book stay. */
function clearThread() {
  if (!window.confirm(t("confirmClear", { name: S.person?.person.name ?? "" }))) return;
  stopTurn();
  S.thread = [];
  saveThreadSoon();
  resetTurnState();
  api("/api/forget", {}).catch(() => {});
  renderConvo();
  renderReplies();
  renderHeader();
  if (S.view === "person") renderSheet(); // it is asked from the profile
}

/** An example is shown on its own: its stage, nobody's memory, nothing saved. */
function loadExample(ex) {
  stopTurn();
  flushThreadSave();
  S.scratch = { stage: ex.stage, exampleId: ex.id };
  S.thread = ex.thread.map((m) => ({ id: uid(), at: null, ...m }));
  resetTurnState();
  renderConvo();
  renderReplies();
  startTurn();
}

function importText(text) {
  const clean = String(text || "").trim();
  if (!clean) return;
  if (S.lastCopied && clean === S.lastCopied.trim()) return toast(t("toastSameAsDraft"));
  const msgs = parseChatText(clean);
  const fromThem = msgs.filter((m) => m.from === "partner").length;
  toast(fromThem === msgs.length ? t("toastImported", { n: msgs.length }) : t("toastImportedMixed", { n: msgs.length }));
  addMessages(msgs);
}

// ---------------- a turn: card, then replies ----------------
function newTurn() {
  return {
    id: uid(), controller: new AbortController(), t0: performance.now(), active: true, phase: "cards",
    policy: null, template: null, noPartner: false, error: null, cancelled: false, quiet: false,
    draft: null, times: { card: null, first: null, all: null }, metrics: null, adultsConfirmed: false,
  };
}

function newDraft(adultsConfirmed) {
  return { active: true, phase: "draft", text: "", candidates: null, ranked: null, error: null, blocked: false, adultsConfirmed };
}

function stopTurn({ quiet = true } = {}) {
  if (S.turn?.active) {
    S.turn.quiet = quiet;
    S.turn.controller.abort();
  }
}

/** What a run sends: the newest SEND_MAX lines and whose chat it is (an example sends its stage
 *  instead). `offset` is where the sent lines start in the page's chat: the server's card
 *  indices count from there. */
function runBody(extra) {
  const sent = S.thread.slice(-SEND_MAX);
  flushThreadSave(); // in parallel: the newest lines are sent with the run anyway
  return {
    body: { personId: S.scratch ? null : S.personId, stage: S.scratch?.stage, thread: plain(sent), ...extra },
    offset: S.thread.length - sent.length,
  };
}

async function startTurn({ adultsConfirmed = false } = {}) {
  if (!S.thread.length || !S.settings.consentAccepted) return;
  stopTurn();
  const turn = newTurn();
  turn.adultsConfirmed = adultsConfirmed;
  turn.personId = S.scratch ? null : S.personId; // whose memory gets what this turn keeps
  S.turn = turn;
  S.shownReplies = new Set();
  S.pending = new Map();
  renderReplies();
  startTicker();
  try {
    const { body, offset } = runBody({ adultsConfirmed });
    turn.offset = offset;
    await stream("/api/turn", body, (type, data) => onEvent(turn, type, data), turn.controller.signal);
  } catch (e) {
    if (turn.controller.signal.aborted) onEvent(turn, "cancelled", {});
    else onEvent(turn, "error", { message: String(e.message || e) });
  }
  if (turn.active) onEvent(turn, "end", {});
}

/** "Another set" (or the same after "we're both adults"): new replies for the same chat and card. */
async function redraft({ adultsConfirmed = S.turn?.draft?.adultsConfirmed ?? false } = {}) {
  if (!S.thread.length) return;
  stopTurn();
  const turn = { ...newTurn(), phase: "draft", policy: S.turn?.policy, template: S.turn?.template, adultsConfirmed };
  turn.times.card = 0;
  turn.draft = newDraft(adultsConfirmed);
  S.turn = turn;
  S.shownReplies = new Set();
  renderReplies();
  startTicker();
  try {
    const { body, offset } = runBody({ card: latestCard(), adultsConfirmed });
    turn.offset = offset;
    await stream("/api/draft", body, (type, data) => onEvent(turn, type, data), turn.controller.signal);
  } catch (e) {
    if (turn.controller.signal.aborted) onEvent(turn, "cancelled", {});
    else onEvent(turn, "error", { message: String(e.message || e) });
  }
  if (turn.active) onEvent(turn, "end", {});
}

function onEvent(turn, type, data) {
  if (S.turn !== turn) return; // a newer turn took over
  const since = () => Math.round(performance.now() - turn.t0);
  const shift = turn.offset || 0; // only the newest lines were sent
  if (shift && typeof data?.idx === "number") data = { ...data, idx: data.idx + shift };
  if (shift && typeof data?.card?.idx === "number") data = { ...data, card: { ...data.card, idx: data.card.idx + shift } };
  switch (type) {
    case "memory": turn.memory = data; break;
    case "memory:saved": turn.saved = data.items; refreshMemory(turn.personId); break;
    case "card:start": S.pending.set(data.idx, { questions: data.questions || [], items: {} }); renderThread(); return;
    case "card:item": {
      const p = S.pending.get(data.idx);
      if (p) { p.items[data.item.id] = data.item; renderThread(); }
      return;
    }
    case "card":
      S.pending.delete(data.card.idx);
      S.cards.set(data.card.idx, data.card);
      renderThread();
      if (data.card.idx !== lastTarget()) return; // an older turn's card: the replies stay as they are
      if (turn.times.card == null) turn.times.card = since();
      break;
    case "card:safety": {
      const c = S.cards.get(data.idx);
      if (c) c.safety = data.safety;
      return;
    }
    case "policy": turn.policy = data; turn.template = data.template ?? turn.template; break;
    case "cards:done": turn.noPartner = !!data.noPartner; break;
    case "draft:begin": turn.phase = "draft"; turn.draft ??= newDraft(turn.adultsConfirmed); break;
    case "draft:start": turn.phase = "draft"; turn.draft ??= newDraft(turn.adultsConfirmed); break;
    case "draft:first": turn.times.first ??= since(); break;
    case "draft:delta":
      turn.draft ??= newDraft(turn.adultsConfirmed);
      turn.draft.text = data.text;
      if (turn.times.first == null && /\n/.test(data.text.trim())) turn.times.first = since();
      renderLiveReplies();
      return;
    case "draft:done":
      turn.draft.candidates = data.candidates;
      turn.draft.error = data.error;
      turn.phase = "rank";
      turn.times.first ??= data.candidates?.length ? since() : null;
      break;
    case "rank:done":
      turn.template = data.template ?? turn.template;
      turn.times.all = since();
      flip($("replies"), () => { turn.draft.ranked = data.ranked; renderReplies(); });
      return;
    case "draft:end":
      if (turn.draft) { turn.draft.active = false; turn.draft.blocked = !!data.blocked; }
      if (data.metrics && !turn.metrics) turn.metrics = data.metrics;
      break;
    case "done":
      turn.metrics = data.metrics;
      turn.noPartner = turn.noPartner || !!data.noPartner;
      turn.active = false;
      turn.phase = "done";
      renderHeader();
      break;
    case "error": turn.error = data.message; turn.active = false; turn.phase = "error"; S.pending.clear(); renderThread(); break;
    case "cancelled": turn.active = false; turn.cancelled = !turn.quiet; turn.phase = "cancelled"; S.pending.clear(); renderThread(); break;
    case "end": turn.active = false; if (turn.phase !== "error" && turn.phase !== "cancelled") turn.phase = "done"; break;
    default: return;
  }
  if (turn.draft && !turn.active) turn.draft.active = false;
  renderReplies();
}

// The live seconds on the status line.
let ticker = null;
function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    if (!S.turn?.active) { clearInterval(ticker); return; }
    for (const el of document.querySelectorAll(".tick[data-t0]")) {
      el.textContent = `${((performance.now() - Number(el.dataset.t0)) / 1000).toFixed(1)} s`;
    }
  }, 100);
}

// ---------------- cards ----------------
const MAX_OPTIONS = 4;
function shownOptions(item) {
  if (item.options.length <= MAX_OPTIONS) return item.options;
  const keep = new Set([...item.options].sort((a, b) => b.p - a.p).slice(0, MAX_OPTIONS).map((o) => o.key));
  return item.options.filter((o) => keep.has(o.key));
}

/** A question as Laya answered it: the answer it leans to, how sure, then the other answers small.
 *  The danger level is a scale from calm to over, lit up to where this chat is. */
function cardItemEl(item) {
  if (item.type === "score") {
    const level = dangerLevel(item.score);
    const band = level == null ? "low" : level <= 3 ? "low" : level <= 6 ? "mid" : "high";
    return h("div", { class: "litem is-danger", dataset: { band } },
      h("p", { class: "lq" }, h("span", null, L(item)), h("span", { class: "lnum" }, h("b", null, level ?? "–"), " / 10")),
      level != null ? h("span", {
        class: "lgauge", role: "meter", "aria-label": L(item), "aria-valuemin": "1", "aria-valuemax": "10",
        "aria-valuenow": String(level), style: { "--p": ((level - 1) / 9).toFixed(3) },
      }, h("i")) : null,
      level != null ? h("p", { class: "lscene" }, HEAT_LEVELS[getLang()][Math.round(item.score)]) : null);
  }
  const low = item.options.length >= 3 && item.p < (S.settings.thresholds?.uncertain ?? 0.45);
  const top = item.options.find((o) => o.key === item.top) || item.options[0];
  const rest = shownOptions(item).filter((o) => o.key !== top.key);
  return h("div", { class: "litem" },
    h("p", { class: "lq" }, L(item), low ? h("span", { class: "unsure" }, t("notSure")) : null),
    h("p", { class: "ltop" }, h("b", null, L(top)), h("span", { class: "lp" }, pct(top.p))),
    h("span", { class: "lbar", "aria-hidden": "true", style: { "--p": Math.min(1, Number(top.p) || 0).toFixed(3) } }, h("i")),
    rest.length ? h("p", { class: "lrest" }, rest.map((o) => h("span", null, L(o), " ", h("span", { class: "lp" }, pct(o.p))))) : null);
}

/** An older card in one line: each answer it leaned to ("危机是否解除？ 还没有 · 危险等级 4/10"). */
function cardSummary(card) {
  return card.items.map((it) => {
    if (it.type === "score") return `${L(it)} ${dangerLevel(it.score) ?? "–"}/10`;
    const top = it.options.find((o) => o.key === it.top) || it.options[0];
    return it.options.length <= 2 ? `${L(it)} ${L(top)}` : L(top); // "是" alone says nothing
  }).join(" · ");
}

function cardHead(card, { state = null, onFold = null, busy = false } = {}) {
  const took = card?.cached ? t("cardCached") : card?.ms != null ? secs(card.ms) : "";
  return h("p", { class: "lcard-head", title: took ? `Laya · ${took}` : null },
    h("span", { class: `lmark${busy ? " is-busy" : ""}`, "aria-hidden": "true" }),
    h("span", { class: "lname" }, "Laya"),
    state ? h("span", { class: "lstate" }, state) : null,
    onFold ? h("button", { class: "lfold", title: t("cardFold"), "aria-label": t("cardFold"), "aria-expanded": "true", onclick: onFold }, icon("chev")) : null);
}

/** The latest card is open; older ones fold into a line under their message and open on a click. */
function cardEl(card, latest, mid) {
  if (card.error) return h("div", { class: "lcard is-error" }, cardHead(card), h("p", null, t("cardFailed", { msg: errText(card.error) })));
  const toggle = () => {
    if (S.openCards.has(mid)) S.openCards.delete(mid);
    else S.openCards.add(mid);
    renderThread({ keepScroll: true });
  };
  if (!latest && !S.openCards.has(mid)) {
    return h("button", {
      class: "lcard is-folded", dataset: { idx: String(card.idx) }, "aria-expanded": "false", title: t("cardOpen"), onclick: toggle,
    }, h("span", { class: "lmark", "aria-hidden": "true" }), h("span", { class: "lsum" }, cardSummary(card)), icon("chev"));
  }
  return h("div", { class: `lcard${latest ? " is-latest" : ""}`, dataset: { idx: String(card.idx) } },
    cardHead(card, { onFold: latest ? null : toggle }),
    card.items.map(cardItemEl),
    card.suggest ? h("p", { class: "lsuggest" }, h("b", null, t("suggestLabel")), L(card.suggest)) : null);
}

function pendingCardEl(p) {
  const head = cardHead(null, { state: t("cardThinking"), busy: true });
  if (!p?.questions?.length) {
    return h("div", { class: "lcard is-pending", "aria-busy": "true" }, head, h("div", { class: "shimmer" }), h("div", { class: "shimmer is-short" }));
  }
  return h("div", { class: "lcard is-pending", "aria-busy": "true" }, head,
    p.questions.map((q) => p.items[q.id]
      ? cardItemEl(p.items[q.id])
      : h("div", { class: "litem is-waiting" }, h("p", { class: "lq" }, L(q)), h("div", { class: "shimmer is-short" }))));
}

// ---------------- replies ----------------
function timesLine(turn) {
  const cell = (label, ms, live) => h("span", { class: "time" }, label, " ",
    ms != null ? h("b", null, secs(ms))
      : live ? h("b", { class: "tick", dataset: { t0: String(turn.t0) } }, "…") : h("b", { class: "dim" }, "–"));
  const phase = turn.phase;
  return h("p", { class: "times" },
    cell(t("tCard"), turn.times.card, phase === "cards"),
    cell(t("tFirst"), turn.times.first, phase === "draft" && turn.times.first == null),
    cell(t("tAll"), turn.times.all, (phase === "draft" || phase === "rank") && turn.times.all == null));
}

function notices(turn) {
  const out = [];
  const p = turn.policy;
  const d = turn.draft;
  if (p?.safety) {
    const note = p.notices?.find((n) => n.kind === "safety");
    const src = p.safetySource === "keyword" ? t("safetySourceKeyword") : t("safetySourceLaya", { p: pct(note?.p) });
    out.push(h("div", { class: "notice is-safety", role: "alert" },
      icon("alert"),
      h("div", null,
        h("p", null, t(`safety_${p.safety}`)),
        h("p", { class: "fine" }, src, " · ", t("safetyFootnote")),
        p.blockDraft && !turn.adultsConfirmed && !turn.active
          ? h("button", { class: "ghost", onclick: () => redraft({ adultsConfirmed: true }) }, t("adultsConfirm")) : null)));
  } else if (p?.mode === "uncertain") {
    out.push(h("p", { class: "notice is-soft" }, t("uncertainNotice")));
  }
  if (latestCard()?.suggest?.stop) out.push(h("p", { class: "notice is-calm" }, t("stopNotice")));
  if (turn.noPartner) out.push(h("p", { class: "notice is-soft" }, t("noPartner")));
  if (d?.error) out.push(h("div", { class: "notice is-warn" }, icon("alert"), t("draftFailed", { msg: errText(d.error) })));
  if (turn.error) out.push(h("div", { class: "notice is-warn" }, icon("alert"), t("runError", { msg: errText(turn.error) })));
  if (turn.cancelled) out.push(h("p", { class: "notice is-soft" }, t("cancelled")));
  return out;
}

function flagText(f) {
  return t(`flag_${f.code}`, { d: f.detail || "" });
}

function replyCard(item, { best = false, template = false, live = false, index = 0 } = {}) {
  const used = S.used === item.text;
  const clickable = !live;
  const seen = `${S.turn?.id}|${item.text}`;
  const settled = !live && S.shownReplies.has(seen);
  if (!live) S.shownReplies.add(seen);
  // Only what helps choose: the pick, a warning when a check found one, and the button.
  return h("article", {
    class: `reply${best ? " is-best" : ""}${template ? " is-template" : ""}${live ? " is-live" : ""}${settled ? " is-settled" : ""}`,
    dataset: { key: item.text, i: String(index) },
  },
  best ? h("p", { class: "reply-badge", title: item.laya != null ? t("layaScore", { p: pct(item.laya) }) : null }, icon("spark"), t("recommended")) : null,
  template ? h("p", { class: "reply-badge is-safe" }, icon("shield"), t("safetyTemplate")) : null,
  h("p", { class: "reply-text" }, item.text, live ? h("span", { class: "caret", "aria-hidden": "true" }) : null),
  clickable || item.flags?.length ? h("div", { class: "reply-meta" },
    item.flags?.length ? item.flags.map((f) => h("span", { class: "flag" }, flagText(f))) : null,
    clickable ? h("button", { class: `use${used ? " is-done" : ""}`, onclick: () => useReply(item.text) },
      icon(used ? "check" : "pen"), used ? t("used") : t("useReply")) : null) : null);
}

function liveLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  const done = lines.slice(0, -1).map(cleanLine).filter((s) => s && !isPreamble(s));
  const tail = cleanLine(lines[lines.length - 1]);
  return { done: done.slice(0, N_REPLIES), tail: done.length < N_REPLIES && !isPreamble(tail) ? tail : "" };
}

function renderLiveReplies() {
  const box = $("reply-list");
  const d = S.turn?.draft;
  if (!box || !d || d.candidates) return renderReplies();
  const { done, tail } = liveLines(d.text);
  fill(box, 
    ...done.map((text, i) => replyCard({ text }, { index: i })),
    ...(tail ? [replyCard({ text: tail }, { live: true, index: done.length })] : []));
  const tl = $("times");
  if (tl) tl.replaceWith(Object.assign(timesLine(S.turn), { id: "times" }));
}

function replyList(turn) {
  const d = turn.draft;
  if (!d) {
    return turn.active
      ? [h("div", { class: "reply is-placeholder" }, h("div", { class: "shimmer" }), h("div", { class: "shimmer is-short" }))]
      : [];
  }
  if (d.blocked) return [];
  if (!d.candidates) {
    const { done, tail } = liveLines(d.text);
    const cards = [...done.map((text, i) => replyCard({ text }, { index: i })), ...(tail ? [replyCard({ text: tail }, { live: true, index: done.length })] : [])];
    return cards.length ? cards : [h("div", { class: "reply is-placeholder" }, h("div", { class: "shimmer" }), h("div", { class: "shimmer is-short" }))];
  }
  const list = d.ranked || d.candidates.map((text, i) => ({ text, index: i, laya: null, flags: null }));
  if (!list.length) return d.error ? [] : [h("p", { class: "notice is-soft" }, t("noCandidates"))];
  return list.map((item, i) => replyCard(item, { best: !!d.ranked && i === 0 && list.length > 1, index: i }));
}

/** The small print under the replies: whether the two models in use are tuned for couple chat
 *  (the server tells; null = can't tell, e.g. a model of your own), and that it is a hint only. */
function tunedNote(e) {
  const laya = e?.judge?.tuned ?? null;
  const gemma = e?.draft?.tuned ?? null;
  if (laya != null && laya === gemma) return t(laya ? "tunedBoth" : "tunedNone");
  const parts = [["Laya", laya], ["Gemma", gemma]].filter(([, v]) => v != null)
    .map(([name, v]) => t(v ? "tunedOne" : "untunedOne", { name }));
  return parts.length ? t("tunedEach", { parts: parts.join(" · ") }) : t("hintOnly");
}

function renderReplies() {
  const box = $("replies");
  const turn = S.turn;
  $("app").classList.toggle("is-busy", !!turn?.active); // the ember in the top bar flickers
  const head = h("div", { class: "replies-head" },
    h("h2", null, icon("spark"), t("repliesTitle")),
    turn && !turn.active && turn.draft && !turn.draft.blocked
      ? h("button", { class: "ghost", onclick: () => redraft() }, icon("redo"), t("redraft")) : null);
  // The small print, once, at the bottom: how far the models are tuned, and how long this turn took.
  const foot = h("div", { class: "replies-foot" },
    h("span", { id: "tuned-note" }, tunedNote(S.engines)),
    turn ? Object.assign(timesLine(turn), { id: "times" }) : null);
  if (!turn) {
    fill(box, head,
      h("div", { class: "replies-empty" },
        h("p", null, t("repliesEmpty")),
        h("div", { class: "ghost-reply", "aria-hidden": "true" }),
        h("div", { class: "ghost-reply is-short", "aria-hidden": "true" })),
      foot);
    return;
  }
  const status = turn.phase === "cards" ? t("waitingCard") : turn.phase === "draft" && !turn.draft?.text ? t("writing")
    : turn.phase === "rank" ? t("ranking") : null;
  fill(box,
    head,
    status ? h("p", { class: "run-status" }, h("span", { class: "pulse-dot", "aria-hidden": "true" }), status) : null,
    ...notices(turn),
    turn.template ? replyCard({ text: turn.template, flags: [] }, { template: true }) : null,
    h("div", { id: "reply-list", class: "reply-list" }, ...replyList(turn)),
    memoryUsedEl(turn),
    savedMemoryEl(turn),
    foot,
  );
}

/** Under the replies, once the turn is over: what was kept from the new lines, each with undo. */
function savedMemoryEl(turn) {
  if (!turn.saved?.length) return null;
  const name = S.personId === turn.personId ? S.person?.person.name ?? "TA" : "TA";
  return h("div", { class: "memory-saved", role: "status" },
    h("p", { class: "memory-title" }, t("savedTitle", { name })),
    turn.saved.map((m) => h("p", { class: "memory-item" },
      m.label ? h("span", { class: "memory-where" }, m.label) : null,
      h("span", { class: "memory-text" }, `「${m.text}」`),
      h("button", { class: "link", onclick: () => forgetMemory(turn.personId, m.id, turn) }, t("undo")))));
}

/** Forget one kept memory: "撤销" under the replies, or "删除" in the profile. */
async function forgetMemory(personId, memoryId, turn) {
  try {
    const r = await api(`/api/people/${personId}/auto/${memoryId}/delete`, {});
    if (turn) turn.saved = turn.saved.filter((m) => m.id !== memoryId);
    if (S.person && S.personId === personId) S.person.memory = r.memory;
    toast(turn ? t("savedUndone") : t("autoDeleted"));
  } catch (e) {
    toast(errText(e.message));
  }
  renderReplies();
  if (S.view === "person") renderSheet();
}

/** Something was kept for this person: an open profile shows it straight away. */
async function refreshMemory(personId) {
  if (!personId || S.personId !== personId || !S.person) return;
  try {
    S.person.memory = (await api(`/api/people/${personId}`)).memory;
    if (S.view === "person") renderSheet();
  } catch { /* the profile shows it next time it opens */ }
}

const LAYER_KEYS = ["layerCore", "layerEvents", "layerFacts", "layerChat"];

/** Under the replies: which of the things you wrote about them this run handed to Gemma. */
function memoryUsedEl(turn) {
  const m = turn.memory;
  if (!m) return null;
  if (!m.used.length) return m.remote ? h("p", { class: "fine memory-note" }, t("memRemote")) : null;
  return h("div", { class: "memory-used" },
    h("p", { class: "memory-title" }, t("memUsed")),
    m.used.map((u) => {
      const layer = t(LAYER_KEYS[u.layer]);
      const where = u.title || (u.section !== layer ? u.section : ""); // no second "了解 TA" after the tag
      return h("p", { class: "memory-item" },
        h("span", { class: `layer is-l${u.layer}` }, layer),
        where ? h("span", { class: "memory-where" }, where) : null,
        h("span", { class: "memory-text" }, u.text));
    }));
}

function flip(container, mutate) {
  const before = new Map([...container.querySelectorAll(".reply[data-key]")].map((el) => [el.dataset.key, el.getBoundingClientRect().top]));
  mutate();
  if (reducedMotion) return;
  for (const el of container.querySelectorAll(".reply[data-key]")) {
    const top = before.get(el.dataset.key);
    if (top === undefined) continue;
    const dy = top - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}

// ---------------- sheets: consent, settings, a person's profile ----------------
function openSheet(view) {
  S.view = view;
  renderSheet();
}

function closeSheet() {
  // Closing the profile keeps what was typed in the book.
  if (S.view === "person" && S.bookDraft != null && S.bookDraft !== S.person?.book) {
    saveBook(S.bookDraft).then(() => toast(t("saved")), () => {});
  }
  S.view = "main";
  renderSheet();
}

function field(label, control, note) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, note ? h("span", { class: "fine" }, note) : null);
}

function textInput(value, onCommit, props = {}) {
  return h("input", { type: "text", value: value ?? "", ...props, onchange: (e) => onCommit(e.target.value.trim()) });
}

function toggle(label, checked, onChange) {
  return h("label", { class: "toggle" },
    h("input", { type: "checkbox", checked, onchange: (e) => onChange(e.target.checked) }),
    h("span", { class: "toggle-ui", "aria-hidden": "true" }), h("span", null, label));
}

function radio(name, value, current, label, onPick) {
  return h("label", { class: "radio" },
    h("input", { type: "radio", name, value, checked: current === value, onchange: () => onPick(value) }),
    h("span", null, label));
}

function flashSaved() {
  const el = document.querySelector(".saved-flash");
  if (!el) return;
  el.classList.add("is-on");
  setTimeout(() => el.classList.remove("is-on"), 1200);
}

async function commit(patch) {
  await save(patch);
  flashSaved();
  renderHeader();
  renderBanner();
  watchEngines();
}

function engineLine(label, st, extra) {
  const status = st?.status || "idle";
  return h("p", { class: "eng-line" }, h("span", { class: `eng is-${status}` }, h("i", { "aria-hidden": "true" }), label),
    " ", h("span", { class: "mono" }, t(`st_${status}`), st?.loadMs != null && status === "ready" ? ` · ${t("readyIn", { s: (st.loadMs / 1000).toFixed(1) })}` : ""),
    extra ? h("span", { class: "mono dim" }, " · ", extra) : null,
    status === "error" && st.error ? h("span", { class: "fine is-warn" }, " ", errText(st.error)) : null);
}

function settingsSheet() {
  const s = S.settings;
  const e = S.engines || { judge: {}, draft: {} };
  const remoteJudge = s.judge.backend === "http";
  const openai = s.draft.backend === "openai";
  const draftNow = e.draft?.backend === "llama-server" ? `llama-server · ${e.draft.threads ?? "?"} threads` : e.draft?.backend || "";
  return h("div", { class: "sheet-inner" },
    h("div", { class: "sheet-head" },
      h("button", { class: "icon-btn", onclick: closeSheet, "aria-label": t("back"), title: t("back") }, icon("back")),
      h("h2", null, t("settings")),
      h("span", { class: "saved-flash" }, t("saved"))),

    e.mock ? null : h("section", { class: "group" },
      h("h3", null, t("sEngines")),
      engineLine(t("engLaya"), e.judge, e.judge?.threads ? `${e.judge.threads} threads` : null),
      engineLine(t("engGemma"), e.draft, draftNow),
      h("p", { class: "fine" }, t("sMemoryNote")),
      h("div", { class: "inline" },
        h("button", { class: "ghost", onclick: async () => { S.engines = await api("/api/engines/release", {}); toast(t("sReleased")); renderSheet(); renderHeader(); } }, t("sRelease")),
        h("button", { class: "ghost", onclick: async () => { S.engines = await api("/api/engines/warm", {}); watchEngines(); renderSheet(); } }, t("sWarm")))),

    e.mock ? null : h("section", { class: "group" },
      h("h3", null, t("sDraft")),
      radio("draft", "auto", s.draft.backend, t("sDraftAuto"), (v) => commit({ draft: { backend: v } }).then(renderSheet)),
      radio("draft", "llama-server", s.draft.backend, t("sDraftLlama"), (v) => commit({ draft: { backend: v } }).then(renderSheet)),
      radio("draft", "ollama", s.draft.backend, t("sDraftOllama"), (v) => commit({ draft: { backend: v } }).then(renderSheet)),
      radio("draft", "openai", s.draft.backend, t("sDraftOpenai"), (v) => commit({ draft: { backend: v } }).then(renderSheet)),
      !openai ? field(t("sModel"), textInput(s.draft.model, (v) => commit({ draft: { model: v } }))) : h("div", { class: "sub" },
        field(t("sHttpBase"), textInput(s.draft.openaiBase, (v) => commit({ draft: { openaiBase: v } }), { placeholder: "https://api.deepseek.com" })),
        field(t("sHttpModel"), textInput(s.draft.openaiModel, (v) => commit({ draft: { openaiModel: v } }), { placeholder: "deepseek-chat" })),
        field(t("sKeyEnv"), textInput(s.draft.openaiKeyEnv, (v) => commit({ draft: { openaiKeyEnv: v } }), { placeholder: "DEEPSEEK_API_KEY" })),
        h("p", { class: "fine is-warn" }, t("sRemoteWarn")))),

    e.mock ? null : h("section", { class: "group" },
      h("h3", null, t("sJudge")),
      radio("judge", "laya-local", s.judge.backend, t("sJudgeLocal"), (v) => commit({ judge: { backend: v } }).then(renderSheet)),
      radio("judge", "http", s.judge.backend, t("sJudgeHttp"), (v) => commit({ judge: { backend: v } }).then(renderSheet)),
      remoteJudge ? h("div", { class: "sub" },
        field(t("sHttpBase"), textInput(s.judge.httpBase, (v) => commit({ judge: { httpBase: v } }).then(renderSheet))),
        field(t("sHttpModel"), textInput(s.judge.httpModel, (v) => commit({ judge: { httpModel: v } }))),
        field(t("sKeyEnv"), textInput(s.judge.httpKeyEnv, (v) => commit({ judge: { httpKeyEnv: v } }), { placeholder: "OPENROUTER_API_KEY" })),
        h("p", { class: "fine is-warn" }, t("sRemoteWarn"))) : null),

    h("section", { class: "group" },
      h("h3", null, t("sMemory")),
      toggle(t("sAutoMemory"), s.autoMemory !== false, (v) => commit({ autoMemory: v }).then(renderSheet)),
      h("p", { class: "fine" }, t("sAutoMemoryNote"))),

    h("section", { class: "group" },
      h("h3", null, t("trashTitle")),
      S.trash.length ? h("ul", { class: "trash-list" }, S.trash.map((x) => h("li", null,
        h("span", null, x.name),
        h("span", { class: "fine" }, t("deletedOn", { date: new Date(x.deletedAt).toLocaleDateString(getLang() === "en" ? "en" : "zh-CN") })),
        h("button", { class: "ghost", onclick: () => restorePerson(x) }, t("restore")))))
        : h("p", { class: "fine" }, t("trashEmpty")),
      h("p", { class: "fine" }, t("trashNote"))),

    h("section", { class: "group" },
      h("h3", null, t("sLang")),
      h("div", { class: "inline" },
        radio("lang", "zh", s.lang, "中文", (v) => switchLang(v)),
        radio("lang", "en", s.lang, "English", (v) => switchLang(v)))),

    h("section", { class: "group about" },
      h("h3", null, t("sAbout")),
      h("p", null, `Laya-Heart ${S.version}`),
      h("p", null, t("sAboutBased"), " ", h("a", { href: "https://github.com/jev-chat/jev-chat-jarvis", target: "_blank", rel: "noopener noreferrer" }, "github.com/jev-chat/jev-chat-jarvis")),
      h("p", null, t("sAboutModels")),
      h("p", null, t("sAboutLicense")),
      h("p", { class: "fine" }, t("sAboutDisclaim"))),
  );
}

/** What the book became: the core card whole, then each searched layer's chunks. */
function memoryPreview(m) {
  const chunkEl = (c) => h("li", { class: "chunk" }, c.title ? h("b", null, c.title, " ") : null, c.text);
  const block = (layer, list, total = list.length) => h("details", { class: "layer-block", open: layer === 1 },
    h("summary", null, h("span", { class: `layer is-l${layer}` }, t(LAYER_KEYS[layer])), " ", t("chunkCount", { n: total })),
    list.length ? h("ol", { class: "chunks" }, list.map(chunkEl)) : h("p", { class: "fine" }, t("layerEmpty")),
    total > list.length ? h("p", { class: "fine" }, t("chatNewest", { n: list.length })) : null);
  return h("section", { class: "group memory" },
    h("h3", null, t("memTitle")),
    h("p", { class: "fine" }, t("memHint")),
    h("details", { class: "layer-block", open: true },
      h("summary", null, h("span", { class: "layer is-l0" }, t("layerCore")), " ",
        m.core ? t("coreChars", { n: m.core.length, max: m.coreMax }) : t("layerEmpty")),
      m.core ? h("pre", { class: "core" }, m.core) : null),
    block(1, m.chunks.filter((c) => c.layer === 1)),
    block(2, m.chunks.filter((c) => c.layer === 2)),
    autoBlock(m.auto || []),
    block(3, m.chat, m.counts.chat));
}

/** In the profile: what was kept from the chat, newest first, in the words said; each can go. */
function autoBlock(list) {
  const day = (d) => (d?.d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : "");
  return h("details", { class: "layer-block", open: list.length > 0 },
    h("summary", null, h("span", { class: "layer is-auto" }, t("autoTitle")), " ", t("autoCount", { n: list.length })),
    h("p", { class: "fine" }, t("autoHint")),
    list.length ? h("ol", { class: "chunks" }, list.map((a) => {
      const head = [day(a.date), a.label].filter(Boolean).join(" ");
      return h("li", { class: "chunk auto-item" },
        head ? h("b", null, head, " ") : null,
        h("span", { class: "dim" }, t(`autoFrom_${a.from}`), "："), a.text, " ",
        h("button", { class: "link", onclick: () => forgetMemory(S.personId, a.id) }, t("autoDelete")));
    })) : null);
}

function personSheet() {
  const p = S.person;
  const book = h("textarea", {
    id: "book", class: "book", rows: "16", spellcheck: "false", maxlength: "50000",
    value: S.bookDraft ?? p.book, oninput: (ev) => { S.bookDraft = ev.target.value; },
  });
  return h("div", { class: "sheet-inner person" },
    h("div", { class: "sheet-head" },
      h("button", { class: "icon-btn", onclick: closeSheet, "aria-label": t("back"), title: t("back") }, icon("back")),
      h("h2", null, t("profileTitle", { name: p.person.name })),
      h("span", { class: "saved-flash" }, t("saved"))),
    h("section", { class: "group" },
      field(t("personName"), h("input", { type: "text", id: "person-name", maxlength: "40", value: p.person.name,
        onchange: (ev) => renamePerson(ev.target.value) }))),
    h("section", { class: "group" },
      h("h3", null, t("bookTitle")),
      h("p", { class: "fine" }, t("bookHint")),
      book,
      h("div", { class: "inline" },
        h("button", { class: "primary", id: "book-save", onclick: () => saveBook(book.value) }, t("saveBook")),
        p.memory.coreTooLong ? h("span", { class: "fine is-warn" }, t("coreTooLong", { max: p.memory.coreMax })) : null)),
    memoryPreview(p.memory),
    h("section", { class: "group" },
      h("div", { class: "inline" },
        h("button", { class: "ghost", onclick: clearThread, disabled: !S.thread.length }, t("clearChat")),
        h("button", { class: "ghost is-danger", onclick: deletePerson }, t("deletePerson"))),
      h("p", { class: "fine" }, t("clearChatNote")),
      h("p", { class: "fine" }, t("deletePersonNote"))));
}

function consentSheet() {
  const start = h("button", {
    class: "primary", disabled: true, onclick: async () => {
      await save({ consentAccepted: true });
      S.engines = await api("/api/engines/warm", {});
      watchEngines();
      closeSheet();
      renderAll();
    },
  }, t("cStart"));
  return h("div", { class: "sheet-inner consent" },
    h("div", { class: "consent-mark", "aria-hidden": "true" }),
    h("h2", null, t("cTitle")),
    h("ol", { class: "consent-list" }, ["c1", "c2", "c3"].map((k) => h("li", null, h("b", null, t(`${k}Lead`)), h("span", null, t(k))))),
    h("label", { class: "check" },
      h("input", { type: "checkbox", id: "adult-check", onchange: (e) => { start.disabled = !e.target.checked; } }),
      h("span", null, t("cAdult"))),
    start,
    h("div", { class: "inline lang-switch" },
      h("button", { class: "link", onclick: () => switchLang("zh") }, "中文"),
      h("button", { class: "link", onclick: () => switchLang("en") }, "English")));
}

function renderSheet() {
  const el = $("sheet");
  if (S.view === "main") {
    el.hidden = true;
    fill(el, );
    $("app").classList.remove("has-sheet");
    return;
  }
  el.hidden = false;
  $("app").classList.add("has-sheet");
  const scroll = el.scrollTop;
  fill(el, S.view === "consent" ? consentSheet() : S.view === "person" && S.person ? personSheet() : settingsSheet());
  el.scrollTop = scroll;
}

async function switchLang(l) {
  await save({ lang: l });
  setLang(l);
  renderAll();
}

function renderAll() {
  renderHeader();
  renderBanner();
  renderConvo();
  renderReplies();
  renderSheet();
}

// ---------------- boot ----------------
/** Before the first answer from the server: how to start it (both languages; settings not known yet). */
function startHint(fromFile) {
  const url = "http://127.0.0.1:5178/";
  const code = (x) => h("code", null, x);
  fill(document.body, h("div", { class: "start-hint" },
    h("p", { class: "empty-title" }, "Laya-Heart"),
    h("p", null, "本机服务还没运行：在应用文件夹里双击 ", code("start.bat"), "（Mac：", code("start.command"), "；Linux：", code("./start.sh"), "）",
      fromFile ? h("span", null, "，然后打开 ", h("a", { href: url }, url)) : "，这个页面会自己连上。"),
    h("p", { class: "fine" }, "The local server isn't running: double-click ", code("start.bat"), " in the app folder (Mac: ", code("start.command"),
      "; Linux: ", code("./start.sh"), ")", fromFile ? h("span", null, ", then open ", h("a", { href: url }, url)) : "; this page connects by itself.")));
}

async function boot() {
  if (location.protocol === "file:") return startHint(true);
  let st;
  for (let shown = false; ;) {
    try {
      st = await api("/api/state");
      break;
    } catch (e) {
      if (String(e.message) !== SERVER_DOWN) throw e;
      if (!shown) { startHint(false); shown = true; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!$("app")) return location.reload(); // the start hint replaced the page; load it fresh
  S.settings = st.settings;
  S.engines = st.engines;
  S.version = st.version;
  setLang(st.settings.lang);
  S.view = st.settings.consentAccepted ? "main" : "consent";
  const people = await loadPeople();
  showPerson(await api(`/api/people/${people.current || people.people[0].id}/open`, {}));
  renderAll();
  watchEngines();
  // Leaving the page: a chat change still waiting to be saved goes now. (A keepalive request
  // carries at most 64 KB, so a very long chat changed in its last 0.3 s can miss this one.)
  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    if (!pendingSave) return;
    fetch(`/api/people/${pendingSave.id}/thread`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ thread: pendingSave.thread }), keepalive: true,
    }).catch(() => {});
    pendingSave = null;
  });

  // Ctrl+V anywhere outside a text box: that's what they said.
  document.addEventListener("paste", (e) => {
    if (S.view !== "main") return;
    const tgt = e.target;
    if (tgt instanceof HTMLElement && (tgt.closest("input, textarea, select") || tgt.isContentEditable)) return;
    const text = e.clipboardData?.getData("text/plain") || "";
    if (!text.trim()) return;
    e.preventDefault();
    importText(text);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && S.view === "main" && S.thread.length) { e.preventDefault(); startTurn(); }
    if (e.key === "Escape" && (S.view === "settings" || S.view === "person")) closeSheet();
  });
  // A click on the dimmed page beside a drawer closes it (the dim layer is the app's ::after);
  // not a text selection that started in the drawer and ended outside it.
  let downOnDim = false;
  $("app").addEventListener("pointerdown", (e) => { downOnDim = e.target === $("app"); });
  $("app").addEventListener("click", (e) => {
    if (downOnDim && e.target === $("app") && (S.view === "settings" || S.view === "person")) closeSheet();
  });
  window.addEventListener("focus", () => watchEngines());
}

boot().catch((e) => {
  document.body.replaceChildren(h("p", { class: "fatal" }, `Laya-Heart: ${e.message || e}`));
});
