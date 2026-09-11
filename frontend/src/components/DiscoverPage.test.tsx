import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import type { CreatorProfile, LiveNotification } from "../lib/social";

const viewer = {
  id: "viewer-1",
  username: "viewer",
  email: "viewer@example.com",
  createdAt: "2026-09-10T12:00:00Z",
};
const alice: CreatorProfile = {
  id: "alice-1",
  username: "alice",
  displayName: "Alice Artist",
  bio: "Studio conversations",
  avatarUrl: "",
  coverUrl: "",
  category: "Creative",
  published: true,
  followerCount: 5,
  isLive: false,
  liveShowId: null,
  liveStartedAt: null,
  isFollowing: false,
  channelVisitors: null,
};
const bob: CreatorProfile = {
  ...alice,
  id: "bob-1",
  username: "bob",
  displayName: "Bob Music",
  category: "Music",
};
let profiles: CreatorProfile[],
  signedIn: boolean,
  failFollow: boolean,
  failList: boolean,
  paginated: boolean;
let updates: LiveNotification[];
function renderAt(
  path = "/",
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function error(status: number, message = "Unavailable") {
  return Response.json({ error: { code: "TEST_ERROR", message } }, { status });
}
beforeEach(() => {
  profiles = [{ ...alice }, { ...bob }];
  signedIn = true;
  failFollow = false;
  failList = false;
  paginated = false;
  updates = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      if (path === "/api/v1/me")
        return signedIn
          ? Response.json({ data: { user: viewer } })
          : error(401);
      if (path === "/api/v1/auth/login") {
        signedIn = true;
        return Response.json({ data: { user: viewer } });
      }
      if (path === "/api/v1/following/count")
        return Response.json({
          data: { count: profiles.filter((p) => p.isFollowing).length },
        });
      if (path === "/api/v1/notifications/read") {
        const ids = JSON.parse(String(init?.body)).ids;
        updates = updates.map((n) => ({
          ...n,
          read: n.read || ids.includes(n.id),
        }));
        return new Response(null, { status: 204 });
      }
      if (path === "/api/v1/notifications")
        return Response.json({
          data: {
            items: updates,
            unreadCount: updates.filter((n) => !n.read).length,
            unreadCapped: false,
          },
        });
      if (path.endsWith("/follow")) {
        if (failFollow) return error(503, "Unable to save follow.");
        const name = path.split("/")[4];
        const following = init?.method === "POST";
        profiles = profiles.map((p) =>
          p.username === name
            ? {
                ...p,
                isFollowing: following,
                followerCount: p.followerCount + (following ? 1 : -1),
              }
            : p,
        );
        return Response.json({ data: { isFollowing: following } });
      }
      if (path === "/api/v1/creators" || path === "/api/v1/following") {
        if (failList) return error(503);
        let items = profiles.filter(
          (p) =>
            (path !== "/api/v1/following" || p.isFollowing) &&
            (!url.searchParams.get("category") ||
              p.category === url.searchParams.get("category")) &&
            (!url.searchParams.get("q") ||
              p.displayName
                .toLowerCase()
                .includes(url.searchParams.get("q")!.toLowerCase())) &&
            (url.searchParams.get("live") !== "true" || p.isLive),
        );
        const nextCursor =
          paginated && !url.searchParams.get("cursor")
            ? "second-page"
            : undefined;
        if (paginated)
          items = url.searchParams.get("cursor")
            ? items.slice(1)
            : items.slice(0, 1);
        return Response.json({ data: { items, nextCursor } });
      }
      if (path === "/api/v1/creators/alice")
        return Response.json({ data: profiles[0] });
      return error(404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("API-backed social discovery", () => {
  it("persists follows through API writes and fresh query clients", async () => {
    const first = renderAt();
    fireEvent.click(
      await screen.findByRole("button", { name: "Follow Alice Artist" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Unfollow Alice Artist" }),
      ).toBeEnabled(),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/creators/alice/follow",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    first.unmount();
    renderAt("/following");
    const feed = within(screen.getByRole("main"));
    expect(
      await feed.findByRole("link", { name: "Visit Alice Artist" }),
    ).toBeInTheDocument();
    expect(
      feed.queryByRole("link", { name: "Visit Bob Music" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Unfollow Alice Artist" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Make yourself at home." }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/creators/alice/follow",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
  it("rolls back a failed optimistic follow and permits retry", async () => {
    failFollow = true;
    renderAt();
    fireEvent.click(
      await screen.findByRole("button", { name: "Follow Alice Artist" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to save follow.",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Follow Alice Artist" }),
      ).toBeEnabled(),
    );
    expect(profiles[0].isFollowing).toBe(false);
    failFollow = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Follow Alice Artist" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Unfollow Alice Artist" }),
      ).toBeEnabled(),
    );
  });
  it("sends search/category/live filters to the server", async () => {
    profiles[1].isLive = true;
    renderAt("/?q=bob&category=Music&live=true");
    expect(
      await within(screen.getByRole("main")).findByRole("link", {
        name: "Visit Bob Music",
      }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/creators?q=bob&category=Music&live=true",
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tech" }));
    expect(
      await screen.findByRole("heading", {
        name: "A new conversation starts with you.",
      }),
    ).toBeInTheDocument();
  });
  it("loads subsequent pages with a server cursor", async () => {
    paginated = true;
    renderAt("/browse");
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more creators" }),
    );
    expect(
      await within(screen.getByRole("main")).findByRole("link", {
        name: "Visit Bob Music",
      }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/creators?cursor=second-page",
      expect.anything(),
    );
  });
  it("keeps signed-out following private and returns a viewer after sign-in", async () => {
    signedIn = false;
    renderAt("/following");
    fireEvent.click(
      await within(screen.getByRole("main")).findByRole("link", {
        name: "Sign in",
      }),
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: viewer.email },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("heading", { name: "Your people. Your place." }),
    ).toBeInTheDocument();
  });
  it("loads durable live updates and marks only displayed IDs read", async () => {
    updates = [
      {
        id: "123",
        username: "alice",
        displayName: alice.displayName,
        avatarUrl: "",
        showId: "show-1",
        createdAt: "2026-09-10T12:00:00Z",
        isLive: true,
        read: false,
      },
    ];
    renderAt();
    fireEvent.click(screen.getByRole("button", { name: "Live notifications" }));
    expect(
      await screen.findByText("Alice Artist went live"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Mark shown updates as read" }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/notifications/read",
      expect.objectContaining({ body: JSON.stringify({ ids: ["123"] }) }),
    );
  });
  it("recovers from a discovery failure using the retry control", async () => {
    failList = true;
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t load creators.",
    );
    failList = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await within(screen.getByRole("main")).findByRole("link", {
        name: "Visit Alice Artist",
      }),
    ).toBeInTheDocument();
  });
  it("does not reuse another account's following cache", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      [
        "social",
        "following",
        { q: "", category: "", live: false },
        "other-account",
      ],
      { pages: [{ items: [alice] }], pageParams: [""] },
    );
    renderAt("/following", client);
    expect(
      await screen.findByRole("heading", { name: "Make yourself at home." }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).queryByRole("link", {
        name: "Visit Alice Artist",
      }),
    ).not.toBeInTheDocument();
  });
});
