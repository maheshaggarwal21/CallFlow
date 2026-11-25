import { test } from "node:test";
import assert from "node:assert/strict";
import * as net from "net";
import * as os from "os";
import { FtpSrv } from "ftp-srv";
import { isHung, IDLE_MS, dropHungConnections } from "./hungSessions";

test("hung = nothing in (no command, no file bytes) for IDLE_MS", () => {
  assert.equal(isHung(0, 0, IDLE_MS - 1), false);
  assert.equal(isHung(0, 0, IDLE_MS), true);
  assert.equal(isHung(0, IDLE_MS * 9.5, IDLE_MS * 10), false); // upload bytes arrived half an IDLE ago
  assert.equal(isHung(0, IDLE_MS * 5, IDLE_MS * 10), true);  // upload stalled (25 Nov, Office 1)
});

async function server() {
  const srv = new FtpSrv({ url: "ftp://127.0.0.1:0", pasv_url: "127.0.0.1", pasv_min: 41000, pasv_max: 41050, anonymous: false });
  srv.on("login", (_d, resolve) => resolve({ root: os.tmpdir() }));
  dropHungConnections(srv, 300, 100);
  await srv.listen();
  return { srv, port: ((srv as unknown as { server: net.Server }).server.address() as net.AddressInfo).port };
}

/** a logged-in session with a STOR in progress; returns the control and data sockets */
async function uploading(port: number, name: string) {
  const ctl = net.connect(port, "127.0.0.1");
  let buf = "";
  const waitFor = (re: RegExp) => new Promise<RegExpMatchArray>((res) => {
    const check = () => { const m = buf.match(re); if (m) { ctl.off("data", on); res(m); } };
    const on = (d: Buffer) => { buf += d.toString(); check(); };
    ctl.on("data", on); check();
  });
  await waitFor(/^220/m);
  ctl.write("USER a\r\nPASS b\r\nTYPE I\r\nPASV\r\n");
  const m = await waitFor(/227 .*\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
  const data = net.connect(Number(m[5]) * 256 + Number(m[6]), "127.0.0.1");
  await new Promise((r) => data.on("connect", r));
  ctl.write(`STOR hung-test-${name}-${process.pid}.wav\r\n`);
  await waitFor(/^150/m);
  data.write(Buffer.alloc(1000));
  return { ctl, data };
}

test("the server closes a session whose upload stalls, and keeps one whose bytes keep coming", async () => {
  const { srv, port } = await server();
  const stalled = await uploading(port, "stalled");
  const flowing = await uploading(port, "flowing");
  const tick = setInterval(() => flowing.data.write(Buffer.alloc(100)), 50);
  const closed = new Promise<boolean>((res) => stalled.ctl.on("close", () => res(true)));
  let flowingClosed = false; flowing.ctl.on("close", () => { flowingClosed = true; });
  for (const s of [stalled.ctl, stalled.data, flowing.ctl, flowing.data]) s.on("error", () => {});
  assert.equal(await Promise.race([closed, new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]), true);
  assert.equal(flowingClosed, false);
  clearInterval(tick);
  for (const s of [stalled.ctl, stalled.data, flowing.ctl, flowing.data]) s.destroy();
  await srv.close();
});

test("a quiet logged-in session with no upload is closed too", async () => {
  const { srv, port } = await server();
  const s = net.connect(port, "127.0.0.1"); s.on("data", () => {}); s.on("error", () => {});
  s.write("USER a\r\nPASS b\r\n");
  const closed = await new Promise<boolean>((res) => { s.on("close", () => res(true)); setTimeout(() => res(false), 2000); });
  assert.equal(closed, true);
  s.destroy(); await srv.close();
});
