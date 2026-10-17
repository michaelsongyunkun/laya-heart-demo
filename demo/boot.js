// Online demo entry: before the page's own script runs, its /api/* requests go to the server that runs
// in this tab (demo/server.js, stand-in models). Everything else is the real page, unchanged.
import { createDemoServer } from "./server.js";
import { DEMO } from "./config.js";

const asked = new URLSearchParams(location.search).get("lang") || navigator.language || "en";
const lang = asked.toLowerCase().startsWith("zh") ? "zh" : "en";
const handle = createDemoServer({ version: DEMO.version, lang });
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return handle(url, init);
  return realFetch(input, init);
};

const TEXT = {
  en: { tag: "Online demo · sample data", body: "The cards and replies come from stand-in code, not the models. The real app runs Laya and Gemma on your own computer.", link: "Get the app" },
  zh: { tag: "线上演示 · 示意数据", body: "卡片和回复由演示用的替身程序生成，不是模型输出。真正的应用在你自己的电脑上跑 Laya 和 Gemma。", link: "下载应用" },
}[lang];
// A strip above the top bar, in the page's own grid (a row of its own), so it never covers the chat or
// the inputs at any window size. × folds it to the tag alone; the tag unfolds it.
const note = document.createElement("aside");
note.className = "demo-note";
note.setAttribute("role", "note");
note.innerHTML = `<strong></strong> <span></span> <a target="_blank" rel="noopener"></a><button type="button"></button>`;
const tag = note.querySelector("strong");
const fold = note.querySelector("button");
fold.textContent = "×";
fold.setAttribute("aria-label", lang === "zh" ? "收起说明" : "Hide the explanation");
fold.addEventListener("click", () => note.classList.add("is-folded"));
tag.addEventListener("click", () => note.classList.remove("is-folded"));
tag.textContent = TEXT.tag;
note.querySelector("span").textContent = TEXT.body;
note.querySelector("a").textContent = TEXT.link;
note.querySelector("a").href = DEMO.appUrl;
const app = document.getElementById("app");
app.classList.add("is-demo");
app.prepend(note);

await import("../web/app.js");
