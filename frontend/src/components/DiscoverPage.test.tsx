import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";

function renderAt(path = "/") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Discovery preview", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("follows a creator across routes, surfaces their live update, and persists after remount", () => {
    const first = renderAt();
    fireEvent.click(screen.getAllByRole("button", { name: "Follow maya" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Live notifications" }));
    expect(
      within(screen.getByRole("region", { name: "Notifications" })).getByText(
        "Maya Chen is live",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /^Following/ }));
    const feed = within(screen.getByRole("main"));
    expect(
      feed.getByRole("link", { name: "Visit Maya Chen" }),
    ).toBeInTheDocument();
    expect(
      feed.queryByRole("link", { name: "Visit Devon Miles" }),
    ).not.toBeInTheDocument();
    first.unmount();
    renderAt("/following");
    fireEvent.click(screen.getByRole("button", { name: "Unfollow maya" }));
    expect(
      screen.getByRole("heading", { name: "Make yourself at home." }),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("combines search, categories and live filtering without calling a discovery API", () => {
    renderAt("/?q=devon&category=Music&live=true");
    const feed = within(screen.getByRole("main"));
    expect(
      feed.getByRole("link", { name: "Visit Devon Miles" }),
    ).toBeInTheDocument();
    expect(
      feed.queryByRole("link", { name: "Visit Maya Chen" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tech" }));
    expect(
      screen.getByRole("heading", { name: "No creators found." }),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps example creator profiles separate from live queues", () => {
    renderAt("/discover/maya");
    expect(screen.getByText(/This is an example creator/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Join the line" }),
    ).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("recovers from malformed locally saved follows", () => {
    localStorage.setItem("bling:design-preview:follows", "not json");
    renderAt("/following");
    expect(
      screen.getByRole("heading", { name: "Make yourself at home." }),
    ).toBeInTheDocument();
  });
  it("shows a followed real channel without inventing a live status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: "NO_LIVE_SHOW" } }, { status: 404 }),
        ),
    );
    renderAt("/u/alice");
    fireEvent.click(
      await screen.findByRole("button", { name: "Follow alice" }),
    );
    fireEvent.click(screen.getByRole("link", { name: /^Following/ }));
    expect(screen.getByRole("heading", { name: "@alice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Visit channel" })).toHaveAttribute(
      "href",
      "/u/alice",
    );
    expect(
      screen.getByText(/Live status updates are coming soon/),
    ).toBeInTheDocument();
  });

  it("hides offline creators when Live now is selected", () => {
    renderAt();
    fireEvent.click(screen.getByRole("button", { name: "Live now" }));
    const feed = within(screen.getByRole("main"));
    expect(
      feed.getByRole("link", { name: "Visit Maya Chen" }),
    ).toBeInTheDocument();
    expect(
      feed.queryByRole("link", { name: "Visit Imani Brooks" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Live now" }));
    expect(
      feed.getByRole("link", { name: "Visit Imani Brooks" }),
    ).toBeInTheDocument();
  });
});
