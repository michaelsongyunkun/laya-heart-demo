# Credits

Laya-Heart is an independent project. These are the open models, runtimes and
libraries it uses, with their licenses.

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
  [`laya-onnx-v1`](https://github.com/sykyyds3739/laya-heart/releases/tag/laya-onnx-v1); see
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
