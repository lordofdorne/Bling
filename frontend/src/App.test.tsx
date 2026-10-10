import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).includes("/live-show")) {
          return new Response(null, {
            status: String(input) === "/api/v1/me" ? 401 : 404,
          });
        }
        return Response.json({
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
        });
      }),
    );
    renderAt("/u/alice");
    expect(
      await screen.findByRole("heading", { name: "The Hotline is open." }),
    ).toBeInTheDocument();
  });

  it("joins the public caller queue without a place in line", async () => {
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
                  priceCents: 0,
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
          return Response.json({ data: { entry } }, { status: 201 });
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
    fireEvent.click(screen.getByRole("button", { name: "Send call request" }));

    expect(await screen.findByText("The host can see you")).toBeInTheDocument();
    const joinCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/queue") && init?.method === "POST",
    );
    expect(
      new Headers(joinCall?.[1]?.headers).get("Idempotency-Key"),
    ).toBeTruthy();
    expect(JSON.parse(String(joinCall?.[1]?.body)).tierId).toBe("tier-1");
  });

  it("restores a caller request after refresh", async () => {
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
                joinedAt: "2026-08-24T12:01:00Z",
              },
            },
          });
        return new Response(null, { status: 404 });
      }),
    );
    renderAt("/u/alice");
    expect(await screen.findByText("The host can see you")).toBeInTheDocument();
    expect(screen.getByText(/request is safely restored/i)).toBeInTheDocument();
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
    expect(
      screen.getByRole("link", { name: /View public page/ }),
    ).toHaveAttribute("href", "/u/alice");
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

  it("keeps a pending registration signed out until email confirmation", async () => {
    const creator = {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: "2026-09-20T12:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/v1/me") {
          return new Response(
            JSON.stringify({ error: { code: "UNAUTHENTICATED" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }
        if (
          String(input) === "/api/v1/auth/register" &&
          init?.method === "POST"
        ) {
          return Response.json(
            { data: { user: creator, confirmationRequired: true } },
            { status: 202 },
          );
        }
        return new Response(null, { status: 404 });
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
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(
        /Check alice@example.com for a confirmation link/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Welcome, alice." }),
    ).not.toBeInTheDocument();
  });

  it("requests a password reset without revealing account existence", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input) === "/api/v1/auth/forgot-password" &&
          init?.method === "POST"
        ) {
          return new Response(null, { status: 202 });
        }
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/forgot-password");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "alice@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(
      await screen.findByText(/If an account exists for that email/i),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/forgot-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "alice@example.com" }),
      }),
    );
  });

  it("submits a new password from the recovery route", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input) === "/api/v1/auth/reset-password" &&
          init?.method === "POST"
        ) {
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/reset-password");
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "a-new-long-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "a-new-long-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByText(/Your password has been updated/i),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/reset-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ password: "a-new-long-password" }),
      }),
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

    expect(
      await screen.findByRole("heading", { name: "Your audience can join." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "End Hotline" }),
    ).toBeInTheDocument();
  });

  it("keeps paid pricing locked until payouts are set up", async () => {
    const creator = {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: "2026-08-24T12:00:00Z",
    };
    const draftShow = {
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
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/v1/me")
          return Response.json({ data: { user: creator } });
        if (path === "/api/v1/shows/current")
          return Response.json({ data: { show: draftShow } });
        if (path === "/api/v1/shows/show-1/tier-config")
          return Response.json({
            data: {
              tiers: [
                {
                  id: "tier-1",
                  name: "Standard",
                  priorityRank: 100,
                  callDurationSeconds: 300,
                  priceCents: 2500,
                  enabled: true,
                  createdAt: "2026-08-24T12:00:00Z",
                  updatedAt: "2026-08-24T12:00:00Z",
                },
              ],
            },
          });
        if (path === "/api/v1/payouts/account")
          return Response.json({
            data: {
              payouts: {
                connected: false,
                transfersStatus: "",
                bankPayoutsStatus: "",
                externalAccountPresent: false,
                chargesEnabled: false,
                payoutsEnabled: false,
                detailsSubmitted: false,
                ready: false,
                requirementsDue: [],
                platformFeePercent: 20,
                creatorProcessingFeePercent: 50,
              },
            },
          });
        return new Response(null, { status: 404 });
      }),
    );

    const user = userEvent.setup();
    renderAt("/dashboard");
    await user.click(
      await screen.findByRole("combobox", { name: "Standard pricing" }),
    );
    expect(
      await screen.findByRole("option", { name: "Free" }),
    ).not.toHaveAttribute("data-disabled");
    expect(
      screen.getByRole("option", { name: "Paid (set up payouts first)" }),
    ).toHaveAttribute("data-disabled");
    await user.keyboard("{Escape}");
    expect(
      await screen.findByText("Set up payouts to charge for calls."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start Hotline" }),
    ).toBeDisabled();
  });

  it("prices a tier once payouts are ready", async () => {
    const creator = {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: "2026-08-24T12:00:00Z",
    };
    const draftShow = {
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
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/v1/me")
          return Response.json({ data: { user: creator } });
        if (path === "/api/v1/shows/current")
          return Response.json({ data: { show: draftShow } });
        if (path === "/api/v1/shows/show-1/tier-config")
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
        if (path === "/api/v1/payouts/account")
          return Response.json({
            data: {
              payouts: {
                connected: true,
                transfersStatus: "active",
                bankPayoutsStatus: "active",
                externalAccountPresent: true,
                chargesEnabled: true,
                payoutsEnabled: true,
                detailsSubmitted: true,
                ready: true,
                requirementsDue: [],
                platformFeePercent: 20,
                creatorProcessingFeePercent: 50,
              },
            },
          });
        return new Response(null, { status: 404 });
      }),
    );

    const user = userEvent.setup();
    renderAt("/dashboard");
    expect(
      screen.queryByRole("textbox", { name: "Standard price in USD" }),
    ).not.toBeInTheDocument();

    await user.click(
      await screen.findByRole("combobox", { name: "Standard pricing" }),
    );
    await user.click(await screen.findByRole("option", { name: "Paid" }));

    const price = await screen.findByRole("textbox", {
      name: "Standard price in USD",
    });
    expect(price).toHaveValue("5.00");
    expect(screen.getByText(/Estimated payout/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save tiers" })).toBeEnabled();
  });

  it("shows each payment's split, then payout status when Stripe is ready", async () => {
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
          return new Response(
            JSON.stringify({ error: { code: "SHOW_NOT_FOUND" } }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        if (path === "/api/v1/payouts/account")
          return Response.json({
            data: {
              payouts: {
                connected: true,
                chargesEnabled: true,
                payoutsEnabled: true,
                detailsSubmitted: true,
                ready: true,
                requirementsDue: [],
                platformFeePercent: 20,
                creatorProcessingFeePercent: 50,
              },
            },
          });
        if (path === "/api/v1/payments/activity")
          return Response.json({
            data: {
              activity: [
                {
                  paymentAttemptId: "attempt-1",
                  amountCents: 2500,
                  platformFeeCents: 551,
                  basicCardFeeCents: 103,
                  creatorProcessingFeeCents: 51,
                  currency: "usd",
                  paymentStatus: "CAPTURED",
                  refundStatus: "SUCCEEDED",
                  createdAt: "2026-08-24T12:00:00Z",
                },
              ],
              payoutFailure: null,
            },
          });
        return new Response(null, { status: 404 });
      }),
    );

    renderAt("/dashboard/settings/payments");
    // Rows on phones, a table from tablet up; the test DOM has both.
    expect((await screen.findAllByText("Refunded")).length).toBe(2);
    expect(screen.getAllByText("$25.00").length).toBe(2);
    // Fees are Bling's 20% plus the creator's half of the card fee.
    expect(screen.getByText("−$5.51")).toBeInTheDocument();
    // A refunded call earns nothing.
    expect(screen.queryByText("$19.49")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Creator payouts" }));
    expect(
      await screen.findByRole("heading", { name: "Balance" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Payouts on")).toBeInTheDocument();
    // The revenue split is in the Terms, not repeated here.
    expect(
      screen.queryByRole("heading", { name: "Your earnings split" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Set up payouts" }),
    ).not.toBeInTheDocument();
  });

  it("renders the balance ledger on the payouts dashboard", async () => {
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
          return new Response(
            JSON.stringify({ error: { code: "SHOW_NOT_FOUND" } }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        if (path === "/api/v1/payouts/account")
          return Response.json({
            data: {
              payouts: {
                connected: false,
                transfersStatus: "",
                bankPayoutsStatus: "",
                externalAccountPresent: false,
                chargesEnabled: false,
                payoutsEnabled: false,
                detailsSubmitted: false,
                ready: false,
                requirementsDue: [],
                platformFeePercent: 20,
                creatorProcessingFeePercent: 50,
              },
            },
          });
        if (path === "/api/v1/payouts/balance")
          return Response.json({
            data: {
              balance: {
                currency: "usd",
                totalCents: 10000,
                pendingCents: 2500,
                availableCents: 7500,
              },
              activity: [
                {
                  id: 2,
                  kind: "EARNING",
                  amountCents: 1949,
                  currency: "usd",
                  effectiveAt: "2026-09-12T18:30:00Z",
                  createdAt: "2026-09-12T18:30:00Z",
                },
                {
                  id: 1,
                  kind: "PAYOUT_RESERVATION",
                  amountCents: -2500,
                  currency: "usd",
                  effectiveAt: "2026-09-01T09:00:00Z",
                  createdAt: "2026-09-01T09:00:00Z",
                },
              ],
            },
          });
        if (path === "/api/v1/payments/activity")
          return Response.json({ data: { activity: [], payoutFailure: null } });
        return new Response(null, { status: 404 });
      }),
    );

    renderAt("/dashboard/settings/payouts");

    // Activity renders as rows on phones and a table from tablet up; the
    // test DOM has both, since CSS decides which one shows.
    expect((await screen.findAllByText("Paid call")).length).toBe(2);
    expect(screen.getAllByText("+$19.49").length).toBe(2);
    expect(screen.getAllByText("Payout to bank").length).toBe(2);
    expect(screen.getAllByText("−$25.00").length).toBe(2);
    expect(screen.getAllByText("Cleared").length).toBe(4);
    // The balance leads with what can be paid out next.
    expect(screen.getByText("Available for payout")).toBeInTheDocument();
    expect(screen.getByText("$75.00")).toBeInTheDocument();
    expect(screen.getByText("On hold")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("Not added")).toBeInTheDocument();
    expect(screen.getByText("Setup needed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set up payouts" }),
    ).toBeInTheDocument();
  });

  it("shows the bank account and payout schedule once Stripe is ready", async () => {
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
        if (path === "/api/v1/payouts/account")
          return Response.json({
            data: {
              payouts: {
                connected: true,
                transfersStatus: "active",
                bankPayoutsStatus: "active",
                externalAccountPresent: true,
                externalAccountBankName: "Test Bank",
                externalAccountLast4: "6789",
                externalAccountCurrency: "usd",
                chargesEnabled: true,
                payoutsEnabled: true,
                detailsSubmitted: true,
                ready: true,
                requirementsDue: [],
                platformFeePercent: 20,
                creatorProcessingFeePercent: 50,
              },
            },
          });
        if (path === "/api/v1/payouts/balance")
          return Response.json({
            data: {
              balance: {
                currency: "usd",
                totalCents: 0,
                pendingCents: 0,
                availableCents: 0,
                nextPayoutAt: "2026-11-01T00:00:00Z",
              },
              activity: [],
            },
          });
        if (path === "/api/v1/payments/activity")
          return Response.json({ data: { activity: [], payoutFailure: null } });
        return new Response(null, { status: 404 });
      }),
    );

    renderAt("/dashboard/settings/payouts");

    expect(await screen.findByText("Test Bank •••• 6789")).toBeInTheDocument();
    // The payout day is a calendar date, whatever the viewer's time zone.
    expect(screen.getByText("Nov 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("Monthly, $25 minimum")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage bank account" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Earnings from paid calls will show here."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nothing yet. Paid calls and payouts will appear here."),
    ).toBeInTheDocument();
  });

  it("shows account details and starts a password change with the email filled in", async () => {
    const creator = {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: "2026-08-24T12:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v1/me")
          return Response.json({ data: { user: creator } });
        return new Response(null, { status: 404 });
      }),
    );

    renderAt("/dashboard/settings/account");

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("/u/alice")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Contact support" }),
    ).toHaveAttribute("href", expect.stringContaining("mailto:"));

    fireEvent.click(screen.getByRole("link", { name: "Change" }));
    expect(await screen.findByLabelText("Email")).toHaveValue(
      "alice@example.com",
    );
  });

  it("asks before removing a saved card", async () => {
    const creator = {
      id: "user-1",
      username: "alice",
      email: "alice@example.com",
      createdAt: "2026-08-24T12:00:00Z",
    };
    let removed = false;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/v1/me")
          return Response.json({ data: { user: creator } });
        if (path === "/api/v1/me/payment-methods")
          return Response.json({
            data: {
              paymentMethods: removed
                ? []
                : [
                    {
                      id: "pm_1",
                      brand: "visa",
                      last4: "4242",
                      expMonth: 4,
                      expYear: 2031,
                    },
                  ],
            },
          });
        if (
          path === "/api/v1/me/payment-methods/pm_1" &&
          init?.method === "DELETE"
        ) {
          removed = true;
          return new Response(null, { status: 204 });
        }
        if (path === "/api/v1/payments/activity")
          return Response.json({ data: { activity: [], payoutFailure: null } });
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/dashboard/settings/payments");

    expect(await screen.findByText("Visa •••• 4242")).toBeInTheDocument();
    expect(screen.getByText("Expires 04/31")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Visa ending in 4242" }),
    );
    // Nothing is removed until the dialog is confirmed.
    expect(
      await screen.findByRole("heading", {
        name: "Remove Visa ending in 4242?",
      }),
    ).toBeInTheDocument();
    expect(removed).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove card" }));
    expect(
      await screen.findByText(
        "No saved cards. Add one now, or save one during your next paid call.",
      ),
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
