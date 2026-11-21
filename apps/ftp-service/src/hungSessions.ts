import type { FtpSrv } from "ftp-srv";

// Office 2's PBX went silent mid-session at 09:44 on 21 Nov 2026 and sent nothing for 6 hours while the socket stayed
// open; a fresh connection at 15:36 got it uploading again. So a session with no command for IDLE_MS is closed (never
// during a file transfer), which makes the box log in again on its next upload.
export const IDLE_MS = 5 * 60_000;
type Sess = { id: string; commandSocket?: import("net").Socket; connector?: { dataSocket?: import("net").Socket | null }; close: () => Promise<unknown> };

/** true when a session should be dropped: quiet for IDLE_MS and no file coming in on it right now */
export function isHung(lastCmdAt: number, now: number, dataSocket?: { destroyed: boolean } | null, idleMs = IDLE_MS) {
  return now - lastCmdAt >= idleMs && !(dataSocket && !dataSocket.destroyed);
}

export function dropHungConnections(server: FtpSrv, idleMs = IDLE_MS, everyMs = 60_000) {
  const last = new Map<string, number>();
  // "connect" is emitted by ftp-srv but missing from its typings
  const ev = server as unknown as import("events").EventEmitter;
  ev.on("connect", ({ connection }: { connection: Sess }) => {
    last.set(connection.id, Date.now());
    connection.commandSocket?.on("data", () => last.set(connection.id, Date.now()));
  });
  ev.on("disconnect", ({ id }: { id: string }) => last.delete(id));
  setInterval(() => {
    const conns = (server as unknown as { connections: Record<string, Sess> }).connections;
    for (const [id, at] of last) {
      const c = conns[id];
      if (!c) { last.delete(id); continue; }
      if (!isHung(at, Date.now(), c.connector?.dataSocket, idleMs)) continue;
      console.warn(`🔌 Closing FTP session silent for ${Math.round((Date.now() - at) / 60_000)} min from ${c.commandSocket?.remoteAddress ?? "?"}`);
      last.delete(id);
      c.close().catch(() => {});
      // a dead peer may never take the goodbye; don't wait on it
      setTimeout(() => c.commandSocket?.destroy(), 5_000).unref();
    }
  }, everyMs).unref();
}

