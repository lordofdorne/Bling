import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProfileEditor } from "./ProfileEditor";
import type { CreatorProfile } from "../lib/social";

const initial: CreatorProfile = {
  id: "user-1",
  username: "alice",
  displayName: "Alice",
  bio: "",
  avatarUrl: "",
  coverUrl: "",
  published: true,
  followerCount: 0,
  isLive: false,
  isFollowing: false,
  liveShowId: null,
  liveStartedAt: null,
  channelVisitors: null,
};
function setup(live = false, fail = false) {
  let profile = { ...initial, isLive: live };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v1/me")
        return Response.json({
          data: { user: { id: profile.id, username: profile.username } },
        });
      if (String(input) === "/api/v1/profile/avatar")
        return Response.json({
          data: { avatarUrl: "/api/v1/creators/alice/avatar" },
        });
      if (init?.method === "POST") {
        if (fail)
          return Response.json(
            { error: { message: "Could not save profile." } },
            { status: 503 },
          );
        profile = { ...profile, ...JSON.parse(String(init.body)) };
      }
      return Response.json({ data: profile });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProfileEditor />
    </QueryClientProvider>,
  );
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());
it("saves real profile fields and keeps a success confirmation after refetch", async () => {
  const fetchMock = setup();
  fireEvent.change(await screen.findByLabelText("Display name"), {
    target: { value: "Alice Creates" },
  });
  fireEvent.change(screen.getByLabelText("About your channel"), {
    target: { value: "Ceramics and conversation" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Profile saved.");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/profile",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        displayName: "Alice Creates",
        bio: "Ceramics and conversation",
        avatarUrl: "",
        coverUrl: "",
        published: true,
        topics: [],
      }),
    }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Display name")).toHaveValue("Alice Creates"),
  );
});
it("preserves the draft when saving fails", async () => {
  setup(false, true);
  fireEvent.change(await screen.findByLabelText("Display name"), {
    target: { value: "Unsaved name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save profile.",
  );
  expect(screen.getByLabelText("Display name")).toHaveValue("Unsaved name");
});
it("uploads a profile picture from the device before saving the profile", async () => {
  const fetchMock = setup();
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "avatar.jpg", {
    type: "image/jpeg",
  });
  fireEvent.change(await screen.findByLabelText("Profile picture"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Profile saved.");

  const uploadCall = fetchMock.mock.calls.find(
    ([input]) => String(input) === "/api/v1/profile/avatar",
  );
  expect(uploadCall?.[1]).toEqual(
    expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
  );
  const saveCall = fetchMock.mock.calls.find(
    ([input, init]) =>
      String(input) === "/api/v1/profile" && init?.method === "POST",
  );
  expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual(
    expect.objectContaining({
      avatarUrl: "/api/v1/creators/alice/avatar",
    }),
  );
});
it("keeps a live profile published", async () => {
  setup(true);
  expect(
    await screen.findByLabelText("Show my profile in discovery"),
  ).toBeDisabled();
});
