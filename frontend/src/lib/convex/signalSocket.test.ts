import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexSignalSocket } from "./signalSocket";

// The Convex call transport, against a fake Convex client: what it sends,
// when, and in which order. The batching and delayed acks are what kept ICE
// as fast as the Go API's WebSocket in the benchmark.

type Inbox = { _id: string; type: string; payload: string }[];

const fake = vi.hoisted(() => {
  const state = {
    mutations: [] as { name: string; args: Record<string, unknown> }[],
    inbox: undefined as unknown,
    fail: false,
    listener: null as null | (() => void),
  };
  const nameOf = (ref: unknown) =>
    String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
  const client = {
    mutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      state.mutations.push({ name: nameOf(ref), args });
    }),
    watchQuery: () => ({
      onUpdate: (listener: () => void) => {
        state.listener = listener;
        return () => {
          state.listener = null;
        };
      },
      localQueryResult: () => {
        if (state.fail) throw new Error("CALL_NOT_FOUND");
        return state.inbox;
      },
    }),
  };
  return { state, client };
});

vi.mock("../backend", () => ({ convexClient: () => fake.client }));

function deliver(signals: Inbox) {
  fake.state.inbox = signals;
  fake.state.listener?.();
}

const sent = () =>
  fake.state.mutations
    .filter((m) => m.name === "signals:send")
    .map((m) => m.args.signals);
const acks = () =>
  fake.state.mutations
    .filter((m) => m.name === "signals:ack")
    .map((m) => m.args.ids);

async function openSocket() {
  const socket = new ConvexSignalSocket("call-1");
  const opened = vi.fn();
  socket.onopen = opened;
  await vi.advanceTimersByTimeAsync(0);
  expect(opened).toHaveBeenCalled();
  expect(socket.readyState).toBe(WebSocket.OPEN);
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.state.mutations = [];
  fake.state.inbox = undefined;
  fake.state.fail = false;
});
afterEach(() => vi.useRealTimers());

describe("ConvexSignalSocket", () => {
  it("sends ICE candidates gathered together as one batch", async () => {
    const socket = await openSocket();
    for (let n = 0; n < 5; n++) {
      socket.send(
        JSON.stringify({ type: "signal.ice", payload: { candidate: n } }),
      );
    }
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toHaveLength(5);
  });

  it("keeps order: pending candidates go before the next signal", async () => {
    const socket = await openSocket();
    socket.send(
      JSON.stringify({ type: "signal.ice", payload: { candidate: 1 } }),
    );
    socket.send(
      JSON.stringify({ type: "signal.offer", payload: { sdp: "x" } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(
      sent().map((batch) => (batch as { type: string }[]).map((s) => s.type)),
    ).toEqual([["signal.ice"], ["signal.offer"]]);
  });

  it("passes each incoming signal on once, and acks them together after a pause", async () => {
    const socket = await openSocket();
    const received: unknown[] = [];
    socket.onmessage = (event) => received.push(JSON.parse(event.data));
    deliver([{ _id: "a", type: "signal.offer", payload: '{"sdp":"x"}' }]);
    deliver([
      { _id: "a", type: "signal.offer", payload: '{"sdp":"x"}' },
      { _id: "b", type: "signal.ice", payload: '{"candidate":1}' },
    ]);
    expect(received).toEqual([
      { type: "signal.offer", payload: { sdp: "x" } },
      { type: "signal.ice", payload: { candidate: 1 } },
    ]);
    await vi.advanceTimersByTimeAsync(200);
    expect(acks()).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(acks()).toEqual([["a", "b"]]);
  });

  it("sends presence heartbeats while open and reports leaving on close", async () => {
    const socket = await openSocket();
    await vi.advanceTimersByTimeAsync(20_000);
    const beats = fake.state.mutations.filter(
      (m) => m.name === "presence:heartbeat",
    );
    expect(beats.length).toBe(3);
    socket.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.mutations.at(-1)?.name).toBe("presence:leave");
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it("closes like a dropped socket when the call can no longer be read", async () => {
    const socket = await openSocket();
    const closed = vi.fn();
    socket.onclose = closed;
    fake.state.fail = true;
    fake.state.listener?.();
    expect(closed).toHaveBeenCalled();
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
