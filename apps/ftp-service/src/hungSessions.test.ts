import { test } from "node:test";
import assert from "node:assert/strict";
import * as net from "net";
import { FtpSrv } from "ftp-srv";
import { isHung, IDLE_MS, dropHungConnections } from "./hungSessions";

test("a quiet session is hung, but never while a file is coming in", () => {
  assert.equal(isHung(0, IDLE_MS - 1), false);
  assert.equal(isHung(0, IDLE_MS), true);
  assert.equal(isHung(0, IDLE_MS * 10, { destroyed: false }), false); // long upload in progress
  assert.equal(isHung(0, IDLE_MS, { destroyed: true }), true);         // last transfer finished
});

test("the server closes a logged-in session that goes quiet, and keeps an active one", async () => {
  const srv = new FtpSrv({ url: "ftp://127.0.0.1:0", anonymous: false });
  srv.on("login", (_d, resolve) => resolve({ root: process.cwd() }));
  dropHungConnections(srv, 300, 100);
  await srv.listen();
  const port = (srv as unknown as { server: net.Server }).server.address() as net.AddressInfo;
  const open = () => new Promise<net.Socket>((res) => { const s = net.connect(port.port, "127.0.0.1", () => res(s)); s.on("data", () => {}); });
  const quiet = await open(), busy = await open();
  for (const s of [quiet, busy]) s.write("USER a\r\nPASS b\r\n");
  const closed = new Promise<boolean>((res) => quiet.on("close", () => res(true)));
  let busyClosed = false; busy.on("close", () => { busyClosed = true; });
  const tick = setInterval(() => busy.write("NOOP\r\n"), 100);
  assert.equal(await Promise.race([closed, new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]), true);
  assert.equal(busyClosed, false);
  clearInterval(tick); busy.destroy(); await srv.close();
});
