// Run: npm run build && node --test dist/lib/asyncErrors.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import { errorHandler } from "./asyncErrors";

test("a rejected async handler answers 500 and the server keeps serving", async () => {
  const app = express();
  const router = express.Router();
  router.use(async (_req, _res, next) => next()); // async middleware still passes through
  router.get("/boom", async () => { throw new Error('column "x" does not exist'); });
  router.get("/sync", () => { throw new Error("sync"); });
  router.get("/ok", async (_req, res) => { res.json({ ok: true }); });
  app.use(router);
  app.use(errorHandler);

  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const errors = console.error;
  console.error = () => {}; // the handler logs each failure; keep test output clean
  try {
    const boom = await fetch(`${base}/boom`);
    assert.equal(boom.status, 500);
    assert.deepEqual(await boom.json(), { error: "Internal server error" });
    assert.equal((await fetch(`${base}/sync`)).status, 500);
    const ok = await fetch(`${base}/ok`);
    assert.deepEqual([ok.status, await ok.json()], [200, { ok: true }]);
  } finally {
    console.error = errors;
    server.close();
  }
});
