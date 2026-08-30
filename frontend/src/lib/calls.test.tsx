import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { ReactNode } from "react";
import { useSelectCaller, useSelectRandomCaller } from "./calls";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("caller selection client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends manual selection and stores the active call", async () => {
    const selectedCall = {
      id: "call-1",
      showId: "show-1",
      queueEntryId: "entry-1",
      status: "CREATED",
      caller: { id: "entry-1", displayName: "Sam" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: selectedCall }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient();
    const { result } = renderHook(() => useSelectCaller("show-1"), {
      wrapper: wrapper(client),
    });

    await act(() => result.current.mutateAsync("entry-1"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/shows/show-1/calls/select",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ queueEntryId: "entry-1" }),
      }),
    );
    expect(client.getQueryData(["shows", "show-1", "calls", "active"])).toEqual(
      selectedCall,
    );
  });

  it("uses the dedicated priority-random endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: { id: "call-2" } }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useSelectRandomCaller("show-1"), {
      wrapper: wrapper(new QueryClient()),
    });

    await act(() => result.current.mutateAsync(undefined));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/shows/show-1/calls/select-random",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
