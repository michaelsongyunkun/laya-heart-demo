// node:crypto for the online demo: random ids from the browser, and a small synchronous hash for the
// book's chunk ids (memory/book.js keeps the first 10 hex digits). The ids only need to be stable
// within this tab, so FNV-1a stands in for SHA-1 here; nothing is checked against a real digest.
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export function randomBytes(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return { toString: (enc) => (enc === "hex" ? toHex(bytes) : String.fromCharCode(...bytes)) };
}

function fnv1a(text, seed) {
  let h = BigInt(seed);
  for (const b of new TextEncoder().encode(text)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export function createHash() {
  let text = "";
  const api = {
    update(s) { text += String(s); return api; },
    digest() { return fnv1a(text, 0xcbf29ce484222325n) + fnv1a(text, 0x84222325cbf29ce4n) + fnv1a(text, 0x1b3cbf29ce484222n).slice(0, 8); },
  };
  return api;
}

export default { randomBytes, createHash };
