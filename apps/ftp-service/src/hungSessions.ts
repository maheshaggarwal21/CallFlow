import type { FtpSrv } from "ftp-srv";

// Office 2's PBX went silent mid-session at 09:44 on 21 Nov 2026 and sent nothing for 6 hours while the socket stayed
// open; a fresh connection at 15:36 got it uploading again. So a session with nothing coming in for IDLE_MS is closed,
// which makes the box log in again on its next upload. On 25 Nov Office 1's box stalled INSIDE two uploads at 12:10
// and sat there for 10 hours: an open transfer only protects a session while its bytes keep arriving.
export const IDLE_MS = 5 * 60_000;
type Sess = { id: string; commandSocket?: import("net").Socket; connector?: { dataSocket?: import("net").Socket | null }; close: () => Promise<unknown> };

/** true when a session should be dropped: no command and no file data for IDLE_MS */
export function isHung(lastCmdAt: number, lastDataAt: number, now: number, idleMs = IDLE_MS) {
  return now - Math.max(lastCmdAt, lastDataAt) >= idleMs;
}

export function dropHungConnections(server: FtpSrv, idleMs = IDLE_MS, everyMs = 60_000) {
  const last = new Map<string, number>();
  // bytes read on the session's open transfer at the last look, and when that count last moved
  const data = new Map<string, { socket: object; bytes: number; at: number }>();
  // "connect" is emitted by ftp-srv but missing from its typings
  const ev = server as unknown as import("events").EventEmitter;
  ev.on("connect", ({ connection }: { connection: Sess }) => {
    last.set(connection.id, Date.now());
    connection.commandSocket?.on("data", () => last.set(connection.id, Date.now()));
  });
  ev.on("disconnect", ({ id }: { id: string }) => { last.delete(id); data.delete(id); });
  setInterval(() => {
    const now = Date.now();
    const conns = (server as unknown as { connections: Record<string, Sess> }).connections;
    for (const [id, at] of last) {
      const c = conns[id];
      if (!c) { last.delete(id); data.delete(id); continue; }
      const ds = c.connector?.dataSocket;
      let dataAt = 0;
      if (ds && !ds.destroyed) {
        const seen = data.get(id);
        // a new transfer, or bytes still arriving, counts as activity now
        if (!seen || seen.socket !== ds || seen.bytes !== ds.bytesRead) data.set(id, { socket: ds, bytes: ds.bytesRead, at: now });
        dataAt = data.get(id)!.at;
      }
      if (!isHung(at, dataAt, now, idleMs)) continue;
      console.warn(`🔌 Closing FTP session silent for ${Math.round((now - Math.max(at, dataAt)) / 60_000)} min from ${c.commandSocket?.remoteAddress ?? "?"}${dataAt ? " (stalled upload)" : ""}`);
      last.delete(id); data.delete(id);
      c.close().catch(() => {});
      // a dead peer may never take the goodbye; don't wait on it
      setTimeout(() => { ds?.destroy(); c.commandSocket?.destroy(); }, 5_000).unref();
    }
  }, everyMs).unref();
}
