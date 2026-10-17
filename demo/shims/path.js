// node:path for the online demo (POSIX only; the demo's files live in memory under /).
const norm = (p) => {
  const abs = String(p).startsWith("/");
  const parts = [];
  for (const s of String(p).replace(/\\/g, "/").split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") parts.pop();
    else parts.push(s);
  }
  return (abs ? "/" : "") + parts.join("/") || (abs ? "/" : ".");
};
export const sep = "/";
export const join = (...parts) => norm(parts.filter((x) => x !== "").join("/"));
export const resolve = (...parts) => {
  let out = "";
  for (const p of parts) out = String(p).startsWith("/") ? String(p) : `${out}/${p}`;
  return norm(out.startsWith("/") ? out : `/${out}`);
};
export const dirname = (p) => norm(p).replace(/\/[^/]*$/, "") || "/";
export const basename = (p, ext = "") => {
  const b = norm(p).split("/").pop();
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
};
export const extname = (p) => {
  const m = /\.[^./]*$/.exec(basename(p));
  return m ? m[0] : "";
};
export default { sep, join, resolve, dirname, basename, extname };
