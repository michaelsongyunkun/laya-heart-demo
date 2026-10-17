// node:fs for the online demo: the few synchronous calls server/settings.js and memory/people.js make,
// kept in this tab's memory. Nothing is written anywhere; reloading the page starts over.
const files = new Map(); // path -> string
const dirs = new Set(["/"]);

const norm = (p) => {
  const parts = [];
  for (const s of String(p).replace(/\\/g, "/").split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") parts.pop();
    else parts.push(s);
  }
  return `/${parts.join("/")}`;
};
const parent = (p) => norm(p).replace(/\/[^/]*$/, "") || "/";
const enoent = (p, op) => Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), { code: "ENOENT" });
const under = (dir, p) => p === dir || p.startsWith(dir === "/" ? "/" : `${dir}/`);

function existsSync(p) {
  const n = norm(p);
  return files.has(n) || dirs.has(n);
}

function mkdirSync(p, opts = {}) {
  const n = norm(p);
  if (!opts.recursive && !dirs.has(parent(n))) throw enoent(p, "mkdir");
  let cur = "";
  for (const s of n.split("/").filter(Boolean)) {
    cur += `/${s}`;
    dirs.add(cur);
  }
}

function readFileSync(p) {
  const n = norm(p);
  if (!files.has(n)) throw enoent(p, "open");
  return files.get(n);
}

function writeFileSync(p, data) {
  const n = norm(p);
  if (!dirs.has(parent(n))) throw enoent(p, "open");
  files.set(n, typeof data === "string" ? data : String(data));
}

function readdirSync(p) {
  const n = norm(p);
  if (!dirs.has(n)) throw enoent(p, "scandir");
  const names = new Set();
  for (const k of [...files.keys(), ...dirs]) {
    if (k !== n && under(n, k)) names.add(k.slice(n === "/" ? 1 : n.length + 1).split("/")[0]);
  }
  return [...names].sort();
}

function renameSync(from, to) {
  const a = norm(from);
  const b = norm(to);
  if (files.has(a)) {
    files.set(b, files.get(a));
    files.delete(a);
    return;
  }
  if (!dirs.has(a)) throw enoent(from, "rename");
  for (const k of [...files.keys()]) if (under(a, k)) { files.set(b + k.slice(a.length), files.get(k)); files.delete(k); }
  for (const k of [...dirs]) if (under(a, k)) { dirs.delete(k); dirs.add(b + k.slice(a.length)); }
}

function rmSync(p, opts = {}) {
  const n = norm(p);
  if (files.delete(n)) return;
  if (!dirs.has(n)) {
    if (opts.force) return;
    throw enoent(p, "rm");
  }
  for (const k of [...files.keys()]) if (under(n, k)) files.delete(k);
  for (const k of [...dirs]) if (under(n, k)) dirs.delete(k);
}

const fs = { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync };
export default fs;
export { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync };
