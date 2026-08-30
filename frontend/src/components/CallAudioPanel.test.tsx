import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { BlingCall } from "../lib/calls";
import { CallAudioPanel } from "./CallAudioPanel";

const call: BlingCall = {
  id: "call-1",
  showId: "show-1",
  queueEntryId: "entry-1",
  status: "CREATED",
  selectionMode: "MANUAL",
  callDurationSeconds: 300,
  startedAt: null,
  endedAt: null,
  expiresAt: null,
  createdAt: "2026-08-30T12:00:00Z",
  updatedAt: "2026-08-30T12:00:00Z",
  caller: {
    id: "entry-1",
    displayName: "Sam",
    topic: "My launch",
    tierName: "Standard",
    priorityRank: 0,
    callDurationSeconds: 300,
  },
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("CallAudioPanel", () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaDevices",
  );

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("requests microphone only after the caller clicks and offers a retry on denial", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: { iceServers: [{ urls: ["stun:relay.test"] }] },
        }),
      ),
    );

    render(<CallAudioPanel call={call} role="viewer" />, { wrapper });
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Allow microphone & connect" }),
    );

    expect(
      await screen.findByText(/Microphone access was denied/i),
    ).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Retry microphone" }),
    ).toBeInTheDocument();
  });

  it("lets the selected caller end before opening a microphone", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/viewer-end")) {
        return Response.json({
          data: { ...call, status: "ENDED", endedAt: "2026-08-30T12:01:00Z" },
        });
      }
      return Response.json({ data: { iceServers: [] } });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CallAudioPanel call={call} role="viewer" />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "End call" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/shows/show-1/calls/call-1/viewer-end",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
