import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
});
