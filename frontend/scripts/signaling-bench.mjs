// Compares call signaling speed on the Go API (WebSocket relay) and Convex
// (signal documents read by live queries).
//
//   node scripts/signaling-bench.mjs [runs]
//
// Needs both local backends: the Go API on :8080 (with Postgres and Redis)
// and `npm run convex` (VITE_CONVEX_URL in .env.local). Each run sets up a
// fresh call, then times the exchange a real call makes before audio flows:
//
//   handshake: caller "ready" → creator offer → caller answer, measured from
//              the caller sending ready to the creator receiving the answer
//   ice:       each side trickles ICE_CANDIDATES candidates one by one,
//              measured until both sides have all of the other's
//
// Numbers are for one machine with both backends local, so they show each
// design's overhead, not production latency, where network round trips add
// the same amount to both.
import { readFileSync } from "node:fs";
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";

const RUNS = Number(process.argv[2] ?? 20);
const ICE_CANDIDATES = 8;
const GO = "http://localhost:8080";
const ORIGIN = "http://localhost:5173";
const SDP = JSON.stringify({
  sdp: { type: "offer", sdp: "v=0\r\n".repeat(60) },
});
const ice = (n) =>
  JSON.stringify({ candidate: { candidate: `candidate:${n}` } });
const suffix = Date.now().toString(36);

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return { p50: pick(0.5), p90: pick(0.9), mean };
}

/** Runs the exchange given a way to send and a way to wait for signals. */
async function exchange(creator, viewer) {
  const started = performance.now();
  const ready = creator.next("signal.ready");
  viewer.send("signal.ready", "{}");
  await ready;
  const offer = viewer.next("signal.offer");
  creator.send("signal.offer", SDP);
  await offer;
  const answer = creator.next("signal.answer");
  viewer.send("signal.answer", SDP);
  await answer;
  const handshake = performance.now() - started;

  const iceStarted = performance.now();
  const toViewer = viewer.count("signal.ice", ICE_CANDIDATES);
  const toCreator = creator.count("signal.ice", ICE_CANDIDATES);
  const candidates = Array.from({ length: ICE_CANDIDATES }, (_, n) => ice(n));
  creator.sendIce(candidates);
  viewer.sendIce(candidates);
  await Promise.all([toViewer, toCreator]);
  return { handshake, ice: performance.now() - iceStarted };
}

/** A participant's view of incoming signals, shared by both backends. */
function inbox() {
  const waiters = [];
  const counts = new Map();
  return {
    deliver(type) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
      for (const waiter of [...waiters]) {
        if (waiter.type === type && counts.get(type) >= waiter.target) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve();
        }
      }
    },
    wait(type, n) {
      const target = (counts.get(type) ?? 0) + n;
      const { promise, resolve } = deferred();
      waiters.push({ type, target, resolve });
      return promise;
    },
  };
}

// ---------------------------------------------------------------- Go API

function cookieJar() {
  const cookies = new Map();
  return {
    async fetch(path, init = {}) {
      const response = await fetch(GO + path, {
        ...init,
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          ...init.headers,
        },
      });
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(";");
        const [name, value] = pair.split("=");
        cookies.set(name, value);
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          `${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`,
        );
      }
      return body?.data;
    },
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
  };
}

function goSocket(url, jar) {
  const box = inbox();
  const socket = new WebSocket(url, {
    headers: { Cookie: jar.header(), Origin: ORIGIN },
  });
  const open = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => box.deliver(JSON.parse(event.data).type);
  return {
    open,
    send: (type, payload) =>
      socket.send(JSON.stringify({ type, payload: JSON.parse(payload) })),
    sendIce(payloads) {
      for (const payload of payloads) this.send("signal.ice", payload);
    },
    next: (type) => box.wait(type, 1),
    count: (type, n) => box.wait(type, n),
    close: () => socket.close(),
  };
}

async function benchGo() {
  const creator = cookieJar();
  await creator.fetch("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: `bench_${suffix}`,
      email: `bench_${suffix}@bling.test`,
      password: "bench-password-123",
    }),
  });
  const { show } = await creator.fetch("/api/v1/shows", { method: "POST" });
  await creator.fetch(`/api/v1/shows/${show.id}/start`, { method: "POST" });
  const ws = GO.replace("http", "ws") + `/api/v1/shows/${show.id}/calls`;

  const results = [];
  try {
    for (let run = 0; run < RUNS; run++) {
      const viewer = cookieJar();
      const { entry } = await viewer.fetch(`/api/v1/shows/${show.id}/queue`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ displayName: `Caller ${run}`, topic: "Bench" }),
      });
      const call = await creator.fetch(
        `/api/v1/shows/${show.id}/calls/select`,
        {
          method: "POST",
          body: JSON.stringify({ queueEntryId: entry.id }),
        },
      );
      const creatorSocket = goSocket(
        `${ws}/${call.id}/creator-signals`,
        creator,
      );
      const viewerSocket = goSocket(`${ws}/${call.id}/signals`, viewer);
      await Promise.all([creatorSocket.open, viewerSocket.open]);
      results.push(await exchange(creatorSocket, viewerSocket));
      creatorSocket.close();
      viewerSocket.close();
      await creator.fetch(
        `/api/v1/shows/${show.id}/calls/${call.id}/creator-end`,
        { method: "POST" },
      );
    }
  } finally {
    await creator.fetch(`/api/v1/shows/${show.id}/end`, { method: "POST" });
  }
  return results;
}

// ---------------------------------------------------------------- Convex

function convexUrl() {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  return env.match(/^VITE_CONVEX_URL=(.+)$/m)[1].trim();
}

async function convexClient(url, params) {
  const client = new ConvexClient(url);
  const { tokens } = await client.action(anyApi.auth.signIn, params);
  client.setAuth(async () => tokens.token);
  return client;
}

/**
 * batched: ICE candidates go in one mutation and acknowledgements wait for a
 * quiet moment, so they never queue ahead of sends (Convex runs one client's
 * mutations in order). Unbatched sends and acks every signal on its own.
 */
function convexParticipant(client, callId, batched) {
  const box = inbox();
  const seen = new Set();
  let unacked = [];
  let ackTimer = null;
  const flushAcks = () => {
    ackTimer = null;
    const ids = unacked.splice(0);
    if (ids.length) client.mutation(anyApi.signals.ack, { callId, ids });
  };
  const unsubscribe = client.onUpdate(
    anyApi.signals.inbox,
    { callId },
    (signals) => {
      const fresh = signals.filter((signal) => !seen.has(signal._id));
      for (const signal of fresh) {
        seen.add(signal._id);
        box.deliver(signal.type);
      }
      unacked.push(...fresh.map((signal) => signal._id));
      if (!batched) flushAcks();
      else if (fresh.length) {
        clearTimeout(ackTimer);
        ackTimer = setTimeout(flushAcks, 250);
      }
    },
  );
  const send = (signals) =>
    client.mutation(anyApi.signals.send, { callId, signals });
  return {
    send: (type, payload) => send([{ type, payload }]),
    sendIce(payloads) {
      const signals = payloads.map((payload) => ({
        type: "signal.ice",
        payload,
      }));
      if (batched) send(signals);
      else for (const signal of signals) send([signal]);
    },
    next: (type) => box.wait(type, 1),
    count: (type, n) => box.wait(type, n),
    close() {
      clearTimeout(ackTimer);
      flushAcks();
      unsubscribe();
    },
  };
}

async function benchConvex(batched) {
  const url = convexUrl();
  const creator = await convexClient(url, {
    provider: "password",
    params: {
      flow: "signUp",
      email: `bench_${suffix}${batched ? "b" : ""}@bling.test`,
      password: "bench-password-123",
      username: `bench_${suffix}${batched ? "b" : ""}`,
    },
  });
  const showId = await creator.mutation(anyApi.shows.create, {});
  await creator.mutation(anyApi.shows.start, { showId });

  const results = [];
  try {
    for (let run = 0; run < RUNS; run++) {
      const viewer = await convexClient(url, { provider: "anonymous" });
      const entry = await viewer.mutation(anyApi.queue.join, {
        showId,
        displayName: `Caller ${run}`,
        topic: "Bench",
      });
      const call = await creator.mutation(anyApi.calls.select, {
        showId,
        entryId: entry._id,
      });
      const creatorSide = convexParticipant(creator, call._id, batched);
      const viewerSide = convexParticipant(viewer, call._id, batched);
      // Let both subscriptions deliver their first (empty) result.
      await Promise.all([
        creator.query(anyApi.signals.inbox, { callId: call._id }),
        viewer.query(anyApi.signals.inbox, { callId: call._id }),
      ]);
      results.push(await exchange(creatorSide, viewerSide));
      creatorSide.close();
      viewerSide.close();
      await creator.mutation(anyApi.calls.transition, {
        callId: call._id,
        status: "ENDED",
      });
      await viewer.close();
    }
  } finally {
    await creator.mutation(anyApi.shows.end, { showId });
    await creator.close();
  }
  return results;
}

// ---------------------------------------------------------------- report

function report(name, results) {
  const handshake = stats(results.map((r) => r.handshake));
  const iceStats = stats(results.map((r) => r.ice));
  const ms = (value) => `${value.toFixed(1)} ms`.padStart(9);
  console.log(
    `${name.padEnd(8)} handshake p50 ${ms(handshake.p50)}  p90 ${ms(handshake.p90)}   |  ` +
      `ICE (${ICE_CANDIDATES}×2) p50 ${ms(iceStats.p50)}  p90 ${ms(iceStats.p90)}`,
  );
}

console.log(`${RUNS} calls per backend, both local\n`);
report("Go API", await benchGo());
report("Convex", await benchConvex(false));
report("Convex+", await benchConvex(true));
console.log("\nConvex+ batches ICE candidates into one send and delays acks.");
process.exit(0);
