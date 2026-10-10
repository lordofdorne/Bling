import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { randomDigits, RESET_CODE_LENGTH } from "./passwordReset";
import { expectCode, setup } from "./test.helpers";

// Runs the real Convex Auth Password flows; only Resend's HTTP API is faked.

const EMAIL = "reset@bling.test";
const OLD_PASSWORD = "original password 1";
const NEW_PASSWORD = "replacement password 2";

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  vi.stubEnv(
    "JWT_PRIVATE_KEY",
    (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " "),
  );
  vi.stubEnv(
    "JWKS",
    JSON.stringify({
      keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }],
    }),
  );
  vi.stubEnv("SITE_URL", "http://localhost:5173");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
  vi.stubEnv("AUTH_RESEND_KEY", "re_test");
  vi.stubEnv("AUTH_EMAIL_FROM", "Bling <noreply@bling.test>");
});

afterEach(() => vi.unstubAllGlobals());

/** Fakes Resend and returns the emails it was asked to send. */
function fakeResend(status = 200) {
  const sent: { to: string[]; subject: string; text: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.resend.com/emails");
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer re_test",
      );
      sent.push(JSON.parse(String(init.body)));
      return new Response("{}", { status });
    }),
  );
  return sent;
}

const codeIn = (email: { text: string }) =>
  email.text.match(/code is (\d+)/)![1];

async function signedUp() {
  const { t } = setup();
  await t.action(api.auth.signIn, {
    provider: "password",
    params: {
      flow: "signUp",
      email: EMAIL,
      password: OLD_PASSWORD,
      username: "resetter",
    },
  });
  const signIn = (params: Record<string, string>) =>
    t.action(api.auth.signIn, { provider: "password", params });
  return { t, signIn };
}

describe("password reset", () => {
  it("emails a code that sets a new password", async () => {
    const { signIn } = await signedUp();
    const sent = fakeResend();

    // Case and spaces don't matter, as at sign-in.
    const started = await signIn({
      flow: "reset",
      email: " Reset@Bling.test ",
    });
    // Sending a code does not sign anyone in.
    expect(started.tokens ?? null).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([EMAIL]);
    const code = codeIn(sent[0]);
    expect(code).toMatch(new RegExp(`^\\d{${RESET_CODE_LENGTH}}$`));
    expect(sent[0].subject).toContain(code);

    const done = await signIn({
      flow: "reset-verification",
      email: EMAIL,
      code,
      newPassword: NEW_PASSWORD,
    });
    expect(done.tokens?.token).toBeTruthy();

    await expect(
      signIn({ flow: "signIn", email: EMAIL, password: OLD_PASSWORD }),
    ).rejects.toThrow();
    const again = await signIn({
      flow: "signIn",
      email: EMAIL,
      password: NEW_PASSWORD,
    });
    expect(again.tokens?.token).toBeTruthy();
  });

  it("rejects a wrong code, a used code, and another account's email", async () => {
    const { signIn } = await signedUp();
    const sent = fakeResend();
    await signIn({ flow: "reset", email: EMAIL });
    const code = codeIn(sent[0]);
    const wrong = code === "00000000" ? "11111111" : "00000000";

    await expect(
      signIn({
        flow: "reset-verification",
        email: EMAIL,
        code: wrong,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow();
    await expect(
      signIn({
        flow: "reset-verification",
        email: "someone@bling.test",
        code,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow();

    await signIn({
      flow: "reset-verification",
      email: EMAIL,
      code,
      newPassword: NEW_PASSWORD,
    });
    await expect(
      signIn({
        flow: "reset-verification",
        email: EMAIL,
        code,
        newPassword: "a third password 3",
      }),
    ).rejects.toThrow();
  });

  it("applies the password rules to the new password", async () => {
    const { signIn } = await signedUp();
    const sent = fakeResend();
    await signIn({ flow: "reset", email: EMAIL });
    await expectCode(
      signIn({
        flow: "reset-verification",
        email: EMAIL,
        code: codeIn(sent[0]),
        newPassword: "short",
      }),
      "VALIDATION_FAILED",
    );
  });

  it("sends nothing for an email without an account", async () => {
    const { signIn } = await signedUp();
    const sent = fakeResend();
    await expect(
      signIn({ flow: "reset", email: "nobody@bling.test" }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("limits how many emails one address gets, however it is typed", async () => {
    const { signIn } = await signedUp();
    const sent = fakeResend();
    for (const email of [EMAIL, "RESET@bling.test", " reset@Bling.test"]) {
      await signIn({ flow: "reset", email });
    }
    await expectCode(signIn({ flow: "reset", email: EMAIL }), "RATE_LIMITED");
    expect(sent).toHaveLength(3);
  });

  it("reports when the email could not be sent", async () => {
    const { signIn } = await signedUp();
    fakeResend(500);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expectCode(
      signIn({ flow: "reset", email: EMAIL }),
      "EMAIL_UNAVAILABLE",
    );
  });

  it("draws every digit", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => randomDigits(8)).join(""),
    );
    expect(seen.size).toBe(10);
  });
});
