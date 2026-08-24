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
  afterEach(() => vi.unstubAllGlobals());

  it("renders the public creator route", () => {
    renderAt("/u/alice");
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /currently closed/i }),
    ).toBeInTheDocument();
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
});
