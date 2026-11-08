/** Real socket.io-client 2.x over a local WebSocket server, with EIO3/SIO4
 * framing. No browser, game account, external server or fake client is used.
 */
import { createRequire } from "node:module";
import { once } from "node:events";
import type { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import io from "socket.io-client";
import { expect, test } from "vitest";
import { DirectSearch, type PreparedConfig, type SearchOutcome } from "@content/page/direct-search";

interface Peer extends EventEmitter {
  send(data: string): void;
  terminate(): void;
}
interface WireServer extends EventEmitter {
  clients: Set<Peer>;
  address(): AddressInfo | string | null;
  close(done: (error?: Error) => void): void;
}
// ws is the existing engine.io-client transitive dependency; no additional
// dependency or ambient module declaration is needed for this test.
const require = createRequire(import.meta.url);
const WebSocketServer = require("ws").Server as new (options: { host: string; port: number }) => WireServer;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>, label: string, ms = 1500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Local Socket.IO wire test timed out: ${label}`)), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

test.each([false, true])("real EIO3 /search wire: existing queue = %s", async existing => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const initialization = deferred<SearchOutcome>();
  const queued = deferred<void>();
  const fault = deferred<never>();
  // The next awaited stage will surface protocol failures without an unhandled
  // rejection if a frame arrives between the readiness and ACK assertions.
  void fault.promise.catch(() => undefined);
  const urls: URL[] = [];
  const connectPackets: string[] = [];
  const requests: unknown[] = [];
  const outcomes: SearchOutcome[] = [];
  let search: DirectSearch | undefined;

  server.on("connection", (peer: Peer, request: IncomingMessage) => {
    urls.push(new URL(request.url || "/", "http://127.0.0.1"));
    peer.on("error", (error: Error) => fault.reject(error));
    peer.on("message", (raw: Buffer) => {
      try {
        const frame = raw.toString();
        if (frame === "2") { peer.send("3"); return; } // EIO3 client ping
        if (frame.startsWith("40/search")) {
          connectPackets.push(frame);
          peer.send("40/search,");
          peer.send(`42/search,${JSON.stringify(["session_initialized", existing ? { timeInSearch: 1234 } : null])}`);
          return;
        }
        if (frame.startsWith("42/search,")) {
          const event = JSON.parse(frame.slice("42/search,".length));
          if (Array.isArray(event) && event[0] === "check_if_user_is_in_game") {
            expect(event[1]).toEqual({ userId: 7 });
            peer.send('42/search,["on_check_if_user_is_in_game",false]');
            return;
          }
          if (!Array.isArray(event) || event[0] !== "start_game_search") throw new Error(`Unexpected application event: ${frame}`);
          requests.push(event[1]);
          peer.send('42/search,["on_start_game_search",{"success":true}]');
        }
      } catch (error) { fault.reject(error instanceof Error ? error : new Error(String(error))); }
    });
    peer.send(`0${JSON.stringify({ sid: "local-wire-only", upgrades: [], pingInterval: 1000, pingTimeout: 1000 })}`);
  });

  try {
    await bounded(once(server, "listening"), "WebSocket server listen");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a loopback TCP server address");
    const config: PreparedConfig = {
      endpoint: `http://127.0.0.1:${address.port}/search`,
      request: { gameMode: "league", role: "player", userId: 7, authKey: "wire-test-only", censorship: ["standard", "prime"] },
    };
    search = new DirectSearch(config, settings => io(settings.endpoint, {
      transports: ["websocket"], forceNew: true, reconnection: false,
      query: { userId: settings.request.userId, authKey: settings.request.authKey, intention: "game_search" },
    }), state => {
      outcomes.push(state);
      if (state === "ready" || state === "existing-search") initialization.resolve(state);
      else if (state === "queued") queued.resolve();
      else if (state === "unavailable" || state === "refused") fault.reject(new Error(`Unexpected search outcome: ${state}`));
    });

    expect(search.prepare()).toBe(true);
    expect(await bounded(Promise.race([initialization.promise, fault.promise]), "namespace session initialization"))
      .toBe(existing ? "existing-search" : "ready");
    // Yield one actual event-loop turn: a deferred automatic request is a bug,
    // even if it was not visible at the exact instant readiness was reported.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(urls).toHaveLength(1);
    expect(urls[0].pathname).toBe("/socket.io/");
    expect(urls[0].searchParams.get("EIO")).toBe("3");
    expect(urls[0].searchParams.get("transport")).toBe("websocket");
    expect(urls[0].searchParams.get("userId")).toBe("7");
    expect(urls[0].searchParams.get("authKey")).toBe("wire-test-only");
    expect(urls[0].searchParams.get("intention")).toBe("game_search");
    expect(connectPackets).toHaveLength(1);
    expect(requests).toEqual([]);

    if (existing) {
      expect(search.ready()).toBe(false);
      expect(search.start()).toBe(false);
      expect(outcomes).toEqual(["existing-search"]);
    } else {
      expect(search.ready()).toBe(true);
      expect(search.start()).toBe(true);
      await bounded(Promise.race([queued.promise, fault.promise]), "start_game_search server ACK");
      expect(requests).toEqual([config.request]);
      expect(outcomes).toEqual(["ready", "sent", "queued"]);
      expect(search.start()).toBe(false);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(requests).toHaveLength(1);
    }
  } finally {
    search?.dispose();
    for (const peer of server.clients) peer.terminate();
    await bounded(new Promise<void>(resolve => server.close(() => resolve())), "WebSocket server cleanup", 500);
  }
}, 4000);
