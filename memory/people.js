// Each person you chat with has a folder of their own, <home>/people/<id>/:
//   person.json  {id, name, stage, createdAt, updatedAt}
//   book.md      what you wrote about them, kept exactly as written
//   chat.jsonl   the chat, one message per line: {id, from, text, at}
//   auto.json    what was kept from the chat without being asked (memory/auto.js, learn.js):
//                {memories: [{id, label, text, quote, from, msgId, saidAt, date, createdAt}],
//                 scanned: [ids of the messages already looked at]}
// Deleting moves the folder to <home>/trash/<id>/: it can be restored for 30 days and is cleared
// at the first start after that. The memory (the book's chunks, what was kept from the chat, the
// older chat as L3 chunks, their index) is computed from these files and kept in memory per
// person; nothing derived is written.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BOOK_MAX, BOOK_TEMPLATE, LAYERS, chatChunks, parseBook } from "./book.js";
import { AUTO_MAX, LABEL_MAX, QUOTE_MAX, autoChunk } from "./auto.js";
import { buildIndex } from "./retrieve.js";
import { STAGES } from "../judge/questions.js";

export const ID_RE = /^[a-z0-9]{10}$/;
export const TRASH_DAYS = 30;
export const NAME_MAX = 40;
export const STORED_MAX = 2000; // messages kept per person; the oldest go first
const TEXT_MAX = 2000;
const MSG_ID = /^[a-z0-9]{1,16}$/;
const DAY = 86400000;

export class PeopleError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// On Windows a file just written can be held for a moment by antivirus or the search indexer,
// and renaming it then fails; try again for up to a second.
function rename(from, to) {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(from, to);
    } catch (e) {
      if (i >= 20 || !["EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

// Write to a temporary file, then rename: a write cut off halfway leaves the old file whole.
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  rename(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

const newId = () => crypto.randomBytes(8).toString("hex").slice(0, 10);
const validDate = (d) => (d && Number.isInteger(d.y) && Number.isInteger(d.m) && Number.isInteger(d.d) ? { y: d.y, m: d.m, d: d.d } : null);

/** One kept memory as stored: anything odd in the file is dropped or cut back. */
function cleanAuto(m) {
  if (!m || !ID_RE.test(String(m.id)) || typeof m.text !== "string" || !m.text.trim()) return null;
  return {
    id: m.id,
    label: String(m.label ?? "").slice(0, LABEL_MAX),
    text: m.text.slice(0, QUOTE_MAX + 20),
    quote: String(m.quote ?? "").slice(0, QUOTE_MAX),
    from: m.from === "me" ? "me" : "partner",
    msgId: String(m.msgId ?? "").slice(0, 16),
    saidAt: Number.isFinite(m.saidAt) ? m.saidAt : null,
    date: validDate(m.date),
    createdAt: Number.isFinite(m.createdAt) ? m.createdAt : 0,
  };
}
const cleanStage = (stage, fallback) => (Object.hasOwn(STAGES, stage) ? stage : fallback);
const cleanName = (name, fallback) => String(name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX) || fallback;

/** Messages as stored: what the page shows, with ids and times; anything else is dropped. */
export function cleanMessages(list) {
  if (!Array.isArray(list)) throw new PeopleError(400, "thread must be an array");
  return list.slice(-STORED_MAX)
    .filter((m) => m && (m.from === "partner" || m.from === "me") && typeof m.text === "string" && m.text.trim())
    .map((m) => ({
      id: MSG_ID.test(String(m.id)) ? String(m.id) : crypto.randomBytes(4).toString("hex"),
      from: m.from,
      text: m.text.slice(0, TEXT_MAX),
      at: Number.isFinite(m.at) ? m.at : null,
    }));
}

export class PeopleStore {
  constructor(home, { now = () => Date.now() } = {}) {
    this.dir = path.join(home, "people");
    this.trashDir = path.join(home, "trash");
    this.now = now;
    this.versions = new Map(); // id -> bumped on every write; keys the memory cache
    this.cache = new Map();
    fs.mkdirSync(this.dir, { recursive: true });
  }

  folder(id) {
    if (!ID_RE.test(String(id))) throw new PeopleError(400, "bad person id");
    return path.join(this.dir, id);
  }

  exists(id) {
    return ID_RE.test(String(id)) && fs.existsSync(path.join(this.dir, id, "person.json"));
  }

  person(id) {
    const person = readJson(path.join(this.folder(id), "person.json"));
    if (!person) throw new PeopleError(404, "no such person");
    return person;
  }

  bump(id) {
    this.versions.set(id, (this.versions.get(id) || 0) + 1);
  }

  list() {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { /* none yet */ }
    return names.filter((n) => ID_RE.test(n)).map((n) => readJson(path.join(this.dir, n, "person.json")))
      .filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  create({ name, stage, book, lang = "zh" } = {}) {
    let id;
    do id = newId(); while (fs.existsSync(path.join(this.dir, id)) || fs.existsSync(path.join(this.trashDir, id)));
    const dir = path.join(this.dir, id);
    fs.mkdirSync(dir, { recursive: true });
    const t = this.now();
    const person = { id, name: cleanName(name, lang === "en" ? "New person" : "新的人"), stage: cleanStage(stage, "dating"), createdAt: t, updatedAt: t };
    writeAtomic(path.join(dir, "book.md"), String(book ?? BOOK_TEMPLATE[lang === "en" ? "en" : "zh"]).slice(0, BOOK_MAX));
    writeAtomic(path.join(dir, "chat.jsonl"), "");
    writeAtomic(path.join(dir, "person.json"), JSON.stringify(person, null, 2)); // last: a half-made folder is not listed
    return person;
  }

  get(id) {
    const person = this.person(id);
    let book = "";
    try { book = fs.readFileSync(path.join(this.folder(id), "book.md"), "utf8"); } catch { /* none */ }
    return { person, book, thread: this.thread(id) };
  }

  thread(id) {
    let text = "";
    try { text = fs.readFileSync(path.join(this.folder(id), "chat.jsonl"), "utf8"); } catch { return []; }
    return text.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  }

  update(id, patch = {}) {
    const person = this.person(id);
    const dir = this.folder(id);
    const next = { ...person, updatedAt: this.now() };
    if (patch.name !== undefined) next.name = cleanName(patch.name, person.name);
    if (patch.stage !== undefined) next.stage = cleanStage(patch.stage, person.stage);
    if (patch.book !== undefined) writeAtomic(path.join(dir, "book.md"), String(patch.book).slice(0, BOOK_MAX));
    writeAtomic(path.join(dir, "person.json"), JSON.stringify(next, null, 2));
    this.bump(id);
    return next;
  }

  saveThread(id, list) {
    const msgs = cleanMessages(list);
    const person = this.person(id);
    const dir = this.folder(id);
    writeAtomic(path.join(dir, "chat.jsonl"), msgs.map((m) => JSON.stringify(m)).join("\n") + (msgs.length ? "\n" : ""));
    writeAtomic(path.join(dir, "person.json"), JSON.stringify({ ...person, updatedAt: this.now() }, null, 2));
    this.bump(id);
    return msgs.length;
  }

  /** The person's memory: the core card, chunks of every layer, the search index, counts per layer. */
  memory(id) {
    const v = this.versions.get(id) || 0;
    const hit = this.cache.get(id);
    if (hit && hit.v === v) return hit.memory;
    const { book, thread } = this.get(id);
    const parsed = parseBook(book);
    const auto = this.auto(id).memories;
    const chunks = [...parsed.chunks, ...auto.map(autoChunk), ...chatChunks(thread)];
    const count = (layer) => chunks.filter((c) => c.layer === layer && c.source === "book").length;
    const memory = {
      core: parsed.core, coreTooLong: parsed.coreTooLong, chunks,
      index: buildIndex(chunks),
      auto: [...auto].sort((a, b) => b.createdAt - a.createdAt),
      counts: { core: parsed.core ? 1 : 0, events: count(LAYERS.EVENTS), facts: count(LAYERS.FACTS),
        auto: auto.length, chat: chunks.filter((c) => c.layer === LAYERS.CHAT).length },
    };
    this.cache.set(id, { v, memory });
    return memory;
  }

  /** What was kept from the chat, and which messages were looked at; fresh: never looked yet. */
  auto(id) {
    const data = readJson(path.join(this.folder(id), "auto.json"));
    if (!data) return { memories: [], scanned: [], fresh: true };
    return {
      memories: (Array.isArray(data.memories) ? data.memories : []).map(cleanAuto).filter(Boolean),
      scanned: (Array.isArray(data.scanned) ? data.scanned : []).map(String).slice(-STORED_MAX),
      fresh: false,
    };
  }

  /**
   * Keep new memories (up to AUTO_MAX in all) and mark messages as looked at.
   * @returns {object[]} the memories kept, with their ids
   */
  addAuto(id, { memories = [], scanned = [] } = {}) {
    this.person(id);
    const have = this.auto(id);
    const room = Math.max(0, AUTO_MAX - have.memories.length);
    const t = this.now();
    const added = memories.slice(0, room).map((m) => cleanAuto({ ...m, id: newId(), createdAt: t })).filter(Boolean);
    const seen = [...new Set([...have.scanned, ...scanned.map(String)])].slice(-STORED_MAX);
    writeAtomic(path.join(this.folder(id), "auto.json"), JSON.stringify({ memories: [...have.memories, ...added], scanned: seen }, null, 1));
    this.bump(id);
    return added;
  }

  /** Forget one kept memory ("撤销", or deleted in the profile). */
  deleteAuto(id, memoryId) {
    if (!ID_RE.test(String(memoryId))) throw new PeopleError(400, "bad memory id");
    const have = this.auto(id);
    const left = have.memories.filter((m) => m.id !== memoryId);
    if (left.length === have.memories.length) return false;
    writeAtomic(path.join(this.folder(id), "auto.json"), JSON.stringify({ memories: left, scanned: have.scanned }, null, 1));
    this.bump(id);
    return true;
  }

  remove(id) {
    const from = this.folder(id);
    this.person(id);
    // Stamp first, then move: a crash in between leaves the person where they were.
    writeAtomic(path.join(from, "deleted.json"), JSON.stringify({ deletedAt: this.now() }));
    fs.mkdirSync(this.trashDir, { recursive: true });
    rename(from, path.join(this.trashDir, id));
    this.cache.delete(id);
    this.bump(id);
  }

  trash() {
    let names = [];
    try { names = fs.readdirSync(this.trashDir); } catch { return []; }
    return names.filter((n) => ID_RE.test(n)).map((n) => {
      const p = readJson(path.join(this.trashDir, n, "person.json"));
      const d = readJson(path.join(this.trashDir, n, "deleted.json"));
      return p && d ? { id: n, name: p.name, stage: p.stage, deletedAt: d.deletedAt } : null;
    }).filter(Boolean).sort((a, b) => b.deletedAt - a.deletedAt);
  }

  restore(id) {
    if (!ID_RE.test(String(id))) throw new PeopleError(400, "bad person id");
    const from = path.join(this.trashDir, id);
    const to = path.join(this.dir, id);
    if (!fs.existsSync(path.join(from, "person.json"))) throw new PeopleError(404, "not in the trash");
    if (fs.existsSync(to)) throw new PeopleError(409, "already there");
    rename(from, to);
    fs.rmSync(path.join(to, "deleted.json"), { force: true });
    this.bump(id);
    return readJson(path.join(to, "person.json"));
  }

  /** Clear what has been in the trash longer than TRASH_DAYS (what the user chose for deleting). */
  purge() {
    const cutoff = this.now() - TRASH_DAYS * DAY;
    const gone = [];
    for (const t of this.trash()) {
      if (t.deletedAt >= cutoff) continue;
      fs.rmSync(path.join(this.trashDir, t.id), { recursive: true, force: true });
      gone.push(t.id);
    }
    return gone;
  }

  /**
   * No one yet (the first start with people, or everyone was deleted): one person "TA". The old
   * global background moves into TA's core card, once: it is cleared from the settings after.
   */
  ensureDefault(settings) {
    const people = this.list();
    if (people.length) return people[0];
    const s = settings.get();
    const lang = s.lang === "en" ? "en" : "zh";
    let book = BOOK_TEMPLATE[lang];
    const bg = String(s.background || "").trim();
    if (bg) book = book.replace(/^#[^\n]*\n/, (head) => `${head}${bg}\n`);
    const person = this.create({ name: "TA", stage: s.stage, book, lang });
    if (bg) settings.update({ background: "" });
    return person;
  }
}
