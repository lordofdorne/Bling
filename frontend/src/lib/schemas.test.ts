import {
  callRequestSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema,
  tierConfigSchema,
} from "./schemas";

function issues(result: { success: boolean; error?: { issues: unknown[] } }) {
  return (result.error?.issues ?? []) as {
    path: (string | number)[];
    message: string;
  }[];
}

describe("form schemas", () => {
  it("normalizes and validates registration", () => {
    const parsed = registerSchema.parse({
      username: "alice_1",
      email: "  alice@example.com ",
      password: "a-long-password",
    });
    expect(parsed.email).toBe("alice@example.com");

    const result = registerSchema.safeParse({
      username: "Al",
      email: "sean@holog",
      password: "short",
    });
    expect(new Set(issues(result).map((issue) => issue.path[0]))).toEqual(
      new Set(["username", "email", "password"]),
    );
  });

  it("requires matching reset passwords", () => {
    const result = resetPasswordSchema.safeParse({
      password: "a-long-password",
      confirmation: "a-different-one",
    });
    expect(issues(result)).toEqual([
      expect.objectContaining({
        path: ["confirmation"],
        message: "Passwords do not match.",
      }),
    ]);
  });

  it("only accepts https cover images", () => {
    const base = {
      displayName: "Alice",
      bio: "",
      avatarUrl: "",
      coverUrl: "",
      published: true,
      topics: ["Advice"],
    };
    expect(profileSchema.safeParse(base).success).toBe(true);
    expect(
      profileSchema.safeParse({ ...base, coverUrl: "http://x.test/a.png" })
        .success,
    ).toBe(false);
  });

  it("accepts up to three known profile topics", () => {
    const base = {
      displayName: "Alice",
      bio: "",
      avatarUrl: "",
      coverUrl: "",
      published: true,
    };
    expect(
      profileSchema.safeParse({ ...base, topics: ["Art", "Tech", "Music"] })
        .success,
    ).toBe(true);
    expect(
      profileSchema.safeParse({
        ...base,
        topics: ["Art", "Tech", "Music", "Money"],
      }).success,
    ).toBe(false);
    expect(profileSchema.safeParse({ ...base, topics: ["Cats"] }).success).toBe(
      false,
    );
  });

  it("requires a topic for a call request", () => {
    expect(
      callRequestSchema.safeParse({
        displayName: "Sam",
        topic: "   ",
        tierId: "tier-1",
      }).success,
    ).toBe(false);
  });

  it("checks tier length and paid minimum", () => {
    const tier = {
      name: "Standard",
      duration: "5",
      paid: false,
      price: "0.00",
      enabled: true,
    };
    expect(tierConfigSchema.safeParse({ tiers: [tier] }).success).toBe(true);

    const result = tierConfigSchema.safeParse({
      tiers: [{ ...tier, duration: "0.25", paid: true, price: "0.40" }],
    });
    expect(issues(result).map((issue) => issue.path.join("."))).toEqual([
      "tiers.0.duration",
      "tiers.0.price",
    ]);

    expect(tierConfigSchema.safeParse({ tiers: [] }).success).toBe(false);
  });
});
