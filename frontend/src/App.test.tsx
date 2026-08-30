import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("renders a closed public creator route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "NO_LIVE_SHOW" } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderAt("/u/alice");
    expect(
      await screen.findByRole("heading", { name: /currently closed/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
  });

  it("renders an open public Hotline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: {
            show: {
              id: "show-1",
              creatorId: "user-1",
              status: "LIVE",
              startedAt: "2026-08-24T12:00:00Z",
              endedAt: null,
              createdAt: "2026-08-24T12:00:00Z",
              updatedAt: "2026-08-24T12:00:00Z",
            },
          },
        }),
      ),
    );
    renderAt("/u/alice");
    expect(
      await screen.findByRole("heading", { name: "The Hotline is open." }),
    ).toBeInTheDocument();
  });

  it("joins the public caller queue and shows a recoverable position", async () => {
    const liveShow = {
      id: "show-1",
      creatorId: "user-1",
      status: "LIVE",
      startedAt: "2026-08-24T12:00:00Z",
      endedAt: null,
      createdAt: "2026-08-24T12:00:00Z",
      updatedAt: "2026-08-24T12:00:00Z",
    };
    const entry = {
      id: "entry-1",
      showId: "show-1",
      displayName: "Sam",
      topic: "My launch",
      status: "WAITING",
      tierId: "tier-1",
      tierName: "Standard",
      priorityRank: 0,
      callDurationSeconds: 300,
      queuePosition: 12,
      joinedAt: "2026-08-24T12:01:00Z",
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/live-show"))
          return Response.json({ data: { show: liveShow } });
        if (path.endsWith("/tiers"))
          return Response.json({
            data: {
              tiers: [
                {
                  id: "tier-vip",
                  name: "VIP",
                  priorityRank: 200,
                  callDurationSeconds: 120,
                  priceCents: 5000,
                },
                {
                  id: "tier-1",
                  name: "Standard",
                  priorityRank: 100,
                  callDurationSeconds: 300,
                  priceCents: 1000,
                },
              ],
            },
          });
        if (path.endsWith("/queue/me"))
          return new Response(
            JSON.stringify({ error: { code: "NOT_IN_QUEUE" } }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            },
          );
        if (path.endsWith("/queue") && init?.method === "POST")
          return Response.json(
            { data: { entry, position: 1 } },
            { status: 201 },
          );
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/u/alice");
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "Sam" },
    });
    fireEvent.change(screen.getByLabelText(/What do you want/), {
      target: { value: "My launch" },
    });
    fireEvent.click(screen.getByLabelText(/Standard/));
    fireEvent.click(screen.getByRole("button", { name: "Join the line" }));

    expect(await screen.findByText("#1")).toBeInTheDocument();
    const joinCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/queue") && init?.method === "POST",
    );
    expect(
      new Headers(joinCall?.[1]?.headers).get("Idempotency-Key"),
    ).toBeTruthy();
    expect(JSON.parse(String(joinCall?.[1]?.body)).tierId).toBe("tier-1");
  });

  it("restores a caller position after refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/live-show"))
          return Response.json({
            data: { show: { id: "show-1", status: "LIVE" } },
          });
        if (path.endsWith("/tiers"))
          return Response.json({ data: { tiers: [] } });
        if (path.endsWith("/queue/me"))
          return Response.json({
            data: {
              position: 3,
              entry: {
                id: "entry-1",
                showId: "show-1",
                displayName: "Sam",
                topic: "My launch",
                status: "WAITING",
                tierId: "tier-1",
                tierName: "Standard",
                priorityRank: 0,
                callDurationSeconds: 300,
                queuePosition: 12,
                joinedAt: "2026-08-24T12:01:00Z",
              },
            },
          });
        return new Response(null, { status: 404 });
      }),
    );
    renderAt("/u/alice");
    expect(await screen.findByText("#3")).toBeInTheDocument();
    expect(screen.getByText(/safely restored/i)).toBeInTheDocument();
  });

  it("renders a not-found state", () => {
    renderAt("/missing");
    expect(
      screen.getByRole("heading", { name: /off the air/i }),
    ).toBeInTheDocument();
  });

  it("redirects an unauthenticated dashboard visitor to sign in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "UNAUTHENTICATED",
              message: "Sign in to continue.",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    renderAt("/dashboard");
    expect(
      await screen.findByRole("heading", { name: "Welcome back." }),
    ).toBeInTheDocument();
  });

  it("signs a creator in and opens the protected dashboard", async () => {
    const creator = {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: "2026-08-24T12:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/v1/me") {
          return new Response(
            JSON.stringify({ error: { code: "UNAUTHENTICATED" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }
        if (path === "/api/v1/auth/login" && init?.method === "POST") {
          return Response.json({ data: { user: creator } });
        }
        return new Response(null, { status: 404 });
      }),
    );

    renderAt("/login");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("heading", { name: "Welcome, alice." }),
    ).toBeInTheDocument();
    expect(screen.getByText("/u/alice")).toBeInTheDocument();
  });

  it("shows a safe registration error from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v1/me") {
          return new Response(
            JSON.stringify({ error: { code: "UNAUTHENTICATED" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            error: {
              code: "USERNAME_TAKEN",
              message: "That username is unavailable.",
            },
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );

    renderAt("/register");
    fireEvent.change(screen.getByLabelText(/^Username/), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "long-enough-password" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Create account" }).closest("form")!,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That username is unavailable.",
      ),
    );
  });

  it("logs out and returns the creator to sign in", async () => {
    const creator = {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: "2026-08-24T12:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/v1/me") {
          return Response.json({ data: { user: creator } });
        }
        if (
          String(input) === "/api/v1/auth/logout" &&
          init?.method === "POST"
        ) {
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 404 });
      }),
    );

    renderAt("/dashboard");
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("heading", { name: "Welcome back." }),
    ).toBeInTheDocument();
  });

  it("starts a Hotline from the creator dashboard", async () => {
    const creator = {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: "2026-08-24T12:00:00Z",
    };
    const createdShow = {
      id: "show-1",
      creatorId: "user-1",
      status: "CREATED",
      startedAt: null,
      endedAt: null,
      createdAt: "2026-08-24T12:00:00Z",
      updatedAt: "2026-08-24T12:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/v1/me") {
          return Response.json({ data: { user: creator } });
        }
        if (path === "/api/v1/shows/current") {
          return new Response(
            JSON.stringify({ error: { code: "NO_LIVE_SHOW" } }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (path === "/api/v1/shows" && init?.method === "POST") {
          return Response.json(
            { data: { show: createdShow } },
            { status: 201 },
          );
        }
        if (path === "/api/v1/shows/show-1/tier-config") {
          return Response.json({
            data: {
              tiers: [
                {
                  id: "tier-1",
                  name: "Standard",
                  priorityRank: 100,
                  callDurationSeconds: 300,
                  priceCents: 0,
                  enabled: true,
                  createdAt: "2026-08-24T12:00:00Z",
                  updatedAt: "2026-08-24T12:00:00Z",
                },
              ],
            },
          });
        }
        if (path === "/api/v1/shows/show-1/start" && init?.method === "POST") {
          return Response.json({
            data: {
              show: {
                ...createdShow,
                status: "LIVE",
                startedAt: "2026-08-24T12:01:00Z",
              },
            },
          });
        }
        return new Response(null, { status: 404 });
      }),
    );

    renderAt("/dashboard");
    fireEvent.click(
      await screen.findByRole("button", { name: "Set up Hotline" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Start Hotline" }),
    );

    expect(await screen.findByText("Hotline live")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "End Hotline" }),
    ).toBeInTheDocument();
  });

  it("ends the active Hotline", async () => {
    const creator = {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: "2026-08-24T12:00:00Z",
    };
    const liveShow = {
      id: "show-1",
      creatorId: "user-1",
      status: "LIVE",
      startedAt: "2026-08-24T12:00:00Z",
      endedAt: null,
      createdAt: "2026-08-24T12:00:00Z",
      updatedAt: "2026-08-24T12:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/v1/me")
          return Response.json({ data: { user: creator } });
        if (path === "/api/v1/shows/current")
          return Response.json({ data: { show: liveShow } });
        if (path === "/api/v1/shows/show-1/end" && init?.method === "POST") {
          return Response.json({
            data: {
              show: {
                ...liveShow,
                status: "ENDED",
                endedAt: "2026-08-24T12:05:00Z",
              },
            },
          });
        }
        return new Response(null, { status: 404 });
      }),
    );

    renderAt("/dashboard");
    fireEvent.click(await screen.findByRole("button", { name: "End Hotline" }));

    expect(
      await screen.findByRole("button", { name: "Set up Hotline" }),
    ).toBeInTheDocument();
  });

  it("shows the durable caller queue to the creator", async () => {
    const creator = {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: "2026-08-24T12:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/v1/me")
          return Response.json({ data: { user: creator } });
        if (path === "/api/v1/shows/current")
          return Response.json({
            data: { show: { id: "show-1", status: "LIVE" } },
          });
        if (path.includes("/shows/show-1/queue"))
          return Response.json({
            data: {
              entries: [
                {
                  id: "entry-1",
                  displayName: "Jordan",
                  topic: "Creator growth",
                  tierName: "Standard",
                  callDurationSeconds: 300,
                },
              ],
            },
          });
        return new Response(null, { status: 404 });
      }),
    );
    renderAt("/dashboard");
    expect(await screen.findByText("Jordan")).toBeInTheDocument();
    expect(screen.getByText("Creator growth")).toBeInTheDocument();
    expect(screen.getByText("1 waiting")).toBeInTheDocument();
  });
});
