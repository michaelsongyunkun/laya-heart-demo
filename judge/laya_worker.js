// Laya in its own process, so a CPU-bound forward pass never blocks the web server and the
// model's memory (~0.7 GB) goes away with the process. A Node child of server/engines.js.
import { LayaLocal } from "./laya_local.js";

const laya = new LayaLocal();
const send = (msg) => process.send?.(msg);

async function handle(msg) {
  const { id, type } = msg || {};
  try {
    let result;
    if (type === "load") result = await laya.load(msg.modelDir, { numThreads: msg.numThreads });
    else if (type === "predict") result = await laya.predict(msg.state, msg.questions);
    else if (type === "info") result = laya.info();
    else throw new Error(`unknown message type ${type}`);
    send({ id, ok: true, result });
  } catch (e) {
    send({ id, ok: false, error: String(e?.message || e) });
  }
}

process.on("message", handle);
send({ type: "ready" });
