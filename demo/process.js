// The two process fields the shared modules read (server/mock.js: the stand-ins' pauses; memory/people.js:
// a temp-file name). A classic script, so it is in place before any module runs.
globalThis.process = { env: { LAYA_HEART_MOCK_DELAY: "1" }, pid: 1 };
