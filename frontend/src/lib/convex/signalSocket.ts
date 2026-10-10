import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexClient } from "../backend";

// Call signaling over Convex, shaped like the WebSocket that
// WebRTCCallManager (webrtc.ts) already drives, so the tested call logic is
// unchanged. Behind it:
//
// - incoming signals arrive through the live signals.inbox query;
// - ICE candidates are batched for BATCH_WINDOW_MS into one signals.send,
//   and handled signals are acknowledged after ACK_DELAY_MS of quiet. Both
//   matter: Convex runs one client's mutations in order, so sending or
//   acknowledging one at a time made ICE about five times slower in the
//   benchmark (docs/convex-migration.md);
// - a presence heartbeat every HEARTBEAT_MS keeps the call alive, and
//   closing reports the participant gone so the disconnect grace starts.

const BATCH_WINDOW_MS = 15;
const MAX_BATCH = 20;
const ACK_DELAY_MS = 250;
const HEARTBEAT_MS = 10_000;

type Outgoing = { type: string; payload: string };
type SignalType =
  | "signal.ready"
  | "signal.offer"
  | "signal.answer"
  | "signal.ice";

export class ConvexSignalSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private readonly callId: Id<"calls">;
  private readonly seen = new Set<string>();
  private unacked: Id<"callSignals">[] = [];
  private ice: Outgoing[] = [];
  private iceTimer: number | null = null;
  private ackTimer: number | null = null;
  private heartbeat: number | null = null;
  private sending: Promise<unknown> = Promise.resolve();
  private readonly unsubscribe: () => void;

  constructor(callId: string) {
    this.callId = callId as Id<"calls">;
    const watch = convexClient().watchQuery(api.signals.inbox, {
      callId: this.callId,
    });
    const deliver = () => {
      try {
        const signals = watch.localQueryResult();
        if (signals) this.receive(signals);
      } catch {
        // The query failed: the call is over or no longer ours.
        this.fail();
      }
    };
    this.unsubscribe = watch.onUpdate(deliver);
    deliver();
    void this.beat();
    this.heartbeat = window.setInterval(() => void this.beat(), HEARTBEAT_MS);
    window.setTimeout(() => {
      if (this.readyState !== WebSocket.CONNECTING) return;
      this.readyState = WebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    if (this.readyState !== WebSocket.OPEN) return;
    const { type, payload } = JSON.parse(data) as {
      type: string;
      payload: unknown;
    };
    const signal = { type, payload: JSON.stringify(payload) };
    if (type === "signal.ice") {
      this.ice.push(signal);
      if (this.ice.length >= MAX_BATCH) this.flushIce();
      else if (this.iceTimer === null) {
        this.iceTimer = window.setTimeout(
          () => this.flushIce(),
          BATCH_WINDOW_MS,
        );
      }
      return;
    }
    // Keep order: candidates gathered before this signal go first.
    this.flushIce();
    this.post([signal]);
  }

  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.flushIce();
    this.flushAcks();
    this.readyState = WebSocket.CLOSED;
    this.stopTimers();
    this.unsubscribe();
    void convexClient()
      .mutation(api.presence.leave, { callId: this.callId })
      .catch(() => undefined);
  }

  private receive(
    signals: { _id: Id<"callSignals">; type: string; payload: string }[],
  ) {
    for (const signal of signals) {
      if (this.seen.has(signal._id)) continue;
      this.seen.add(signal._id);
      this.unacked.push(signal._id);
      this.onmessage?.({
        data: JSON.stringify({
          type: signal.type,
          payload: JSON.parse(signal.payload),
        }),
      });
    }
    if (this.unacked.length) {
      if (this.ackTimer !== null) window.clearTimeout(this.ackTimer);
      this.ackTimer = window.setTimeout(() => this.flushAcks(), ACK_DELAY_MS);
    }
  }

  private flushIce() {
    if (this.iceTimer !== null) window.clearTimeout(this.iceTimer);
    this.iceTimer = null;
    while (this.ice.length) this.post(this.ice.splice(0, MAX_BATCH));
  }

  private flushAcks() {
    if (this.ackTimer !== null) window.clearTimeout(this.ackTimer);
    this.ackTimer = null;
    const ids = this.unacked.splice(0);
    if (!ids.length) return;
    void convexClient()
      .mutation(api.signals.ack, { callId: this.callId, ids })
      .catch(() => undefined);
  }

  private post(signals: Outgoing[]) {
    const callId = this.callId;
    this.sending = this.sending.then(() =>
      convexClient()
        .mutation(api.signals.send, {
          callId,
          signals: signals.map((s) => ({
            type: s.type as SignalType,
            payload: s.payload,
          })),
        })
        .catch(() => this.fail()),
    );
  }

  private async beat() {
    try {
      await convexClient().mutation(api.presence.heartbeat, {
        callId: this.callId,
      });
    } catch {
      // The call ended or the connection dropped; the call state decides.
    }
  }

  private fail() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.stopTimers();
    this.unsubscribe();
    this.onerror?.();
    this.onclose?.();
  }

  private stopTimers() {
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    if (this.iceTimer !== null) window.clearTimeout(this.iceTimer);
    if (this.ackTimer !== null) window.clearTimeout(this.ackTimer);
    this.heartbeat = this.iceTimer = this.ackTimer = null;
  }
}
