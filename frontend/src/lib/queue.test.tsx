import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { useQueueEvents } from "./queue";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function EventProbe({
  audience = "viewer",
}: {
  audience?: "viewer" | "creator";
}) {
  useQueueEvents("show-1", audience, true);
  return null;
}

describe("queue realtime client", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resynchronizes REST state on connect and show events", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = render(<EventProbe />, { wrapper: wrapper(client) });
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toContain("/shows/show-1/queue/events");

    act(() => socket.onopen?.());
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    invalidate.mockClear();
    act(() =>
      socket.onmessage?.({
        data: JSON.stringify({ type: "queue.joined", showId: "show-1" }),
      }),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalled());

    view.unmount();
    expect(socket.close).toHaveBeenCalledWith(1000, "page changed");
  });

  it("uses the protected creator endpoint", () => {
    const client = new QueryClient();
    render(<EventProbe audience="creator" />, { wrapper: wrapper(client) });
    expect(FakeWebSocket.instances[0].url).toContain("/queue/creator-events");
  });

  it("reconnects with a delay after an unexpected close", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const client = new QueryClient();
    render(<EventProbe />, { wrapper: wrapper(client) });
    act(() => FakeWebSocket.instances[0].onclose?.());
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(500));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
