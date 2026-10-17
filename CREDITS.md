# Credits

Laya-Heart is built on **Jev Chat Assistant** — 基于 Jev 聊天助手二次开发:
[jev-chat/jev-chat-jarvis](https://github.com/jev-chat/jev-chat-jarvis) (MIT) and
[jev-chat/jev-chat-jarvis-mac](https://github.com/jev-chat/jev-chat-jarvis-mac) (MIT).
It is not made or endorsed by their authors. Their LICENSE and NOTICE files are in
[`third_party/`](third_party/).

## What we borrowed, and where it lives

No file was copied wholesale. We borrowed ideas and small patterns, and each place that
uses one says so in its header comment.

| From | What | Used in |
| --- | --- | --- |
| jev-chat-jarvis `cn/tools/jev/questions.py` | How to write judge questions: English instructions, chat kept in its language, score levels as concrete scenes, no contradictions between questions; the 7-question idea | `judge/questions.js` (our own 8 couple-chat questions) |
| jev-chat-jarvis `cn/tools/jev/` | ChatState as a JSON object with the last 10 messages | `judge/state.js` |
| jev-chat-jarvis-mac `src/generate.py` (`jev_request_url`) | The `/v1/systemone` URL rule for TypeSafe-compatible endpoints | `judge/systemone_http.js` |
| jev-chat-jarvis-mac `src/judge_jev.py` | Ranking drafts as one more `choice` question with the drafts as options | `judge/questions.js` (`rankQuestion`) |
| jev-chat-jarvis-mac `src/generate.py` | Small models label and number their lines; strip that before showing them | `draft/parse.js` |
| jev-chat-jarvis `global/…/engine/CandidateCheck.kt` | The reply checklist: new promises, made-up facts, hurtful wording | `policy/checks.js` (as code rules) |
| jev-chat-jarvis `global/…/scene/RomanceScene.kt` | Judging relative to the relationship stage | `judge/questions.js` (`STAGES`, our wording) |
| jev-chat-jarvis `global/…/session/Fill.kt`, `diagnostics/Diagnostics.kt` | Never send for the user; logs hold numbers only | `server/http.js`, `core/pipeline.js` |

What is ours: the couple-chat question set and per-message cards, the local web page (you paste;
it connects to no chat app — no screen capture, no watching in the background), running both
models on the user's machine with a prompt laid out for llama.cpp's cache, the policy layer
(confidence gate, safety signals, the human-written safe reply), and the latency benchmark.

## Models and runtimes

- **Laya** by Convai Innovations — [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya),
  Apache-2.0. We vendor the compiled `laya-ts` runtime and its `export_onnx.py` from commit
  `c73908d96ff73c0062c340a11bf7c54ec7d8bc4d`, unmodified ([`vendor/laya-ts/`](vendor/laya-ts/)).
- **Laya-multilingual** checkpoint — [convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya)
  (subfolder `multilingual`, revision `7b928d828b7b0e022f929d9bd2e44165aa270148`), Apache-2.0,
  built on [jhu-clsp/mmBERT-base](https://huggingface.co/jhu-clsp/mmBERT-base) (MIT). The
  app downloads this project's fine-tune of it (v3) as fp32 ONNX from
  [YunkunSong/laya-heart-laya-onnx](https://huggingface.co/YunkunSong/laya-heart-laya-onnx)
  (folder `v3/`, with both licenses and a NOTICE). The unchanged zero-shot conversion is in the
  same repo (`zero-shot/`) and in this repo's release
  [`laya-onnx-v1`](https://github.com/r5x8ksva-del/laya-heart/releases/tag/laya-onnx-v1); see
  [`models/README.md`](models/README.md).
- **Gemma 4 E2B** by Google — Apache-2.0. The first start downloads this project's fine-tune of it
  (v4, a Q4_K_M GGUF) from [YunkunSong/laya-heart-gemma-e2b-v4-GGUF](https://huggingface.co/YunkunSong/laya-heart-gemma-e2b-v4-GGUF)
  onto the user's computer. Google's QAT Q4_0 GGUF
  ([google/gemma-4-E2B-it-qat-q4_0-gguf](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf))
  or [Ollama](https://ollama.com)'s `gemma4:e2b` can be used instead. Not redistributed in this repo.
- **llama.cpp** ([ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp), MIT): the first start
  downloads the official `b11617` CPU build of `llama-server` from its GitHub releases; the
  `llama-server` that ships with Ollama (MIT) also works. Neither is redistributed here.
- **Node.js** (MIT): when a computer has no Node.js 22+, the start scripts download the official
  v24.15.0 build from nodejs.org into the app folder. Not redistributed here.
- **onnxruntime-node** (Microsoft, MIT), **playwright-core** for tests (Apache-2.0).
