import Resend from "@auth/core/providers/resend";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type ActionCtx } from "./_generated/server";
import { fail } from "./lib/errors";
import { rateLimit } from "./lib/social";

// Password reset by emailed code, the Convex Auth pattern
// (labs.convex.dev/auth/config/passwords). The Password provider looks up the
// account, Convex Auth stores a hash of the code, and reset-verification
// checks the code together with the email, then signs the person in and ends
// their other sessions. Convex Auth also limits failed code guesses.
//
// Environment:
//   AUTH_RESEND_KEY       Resend API key.
//   AUTH_EMAIL_FROM       Sender, e.g. "Bling <noreply@blinghotline.com>". The
//                         domain must be verified in Resend.
//   AUTH_EMAIL_LOG_CODES  "true" logs codes instead of sending them. Local only.

export const RESET_CODE_LENGTH = 8;
const CODE_MINUTES = 15;
// Each request emails the account owner, so cap it per address.
const SENDS_PER_WINDOW = 3;
const SEND_WINDOW_MS = 15 * 60_000;

export const ResendPasswordReset = Resend({
  id: "password-reset",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: CODE_MINUTES * 60,
  generateVerificationToken: async () => randomDigits(RESET_CODE_LENGTH),
  // Convex Auth passes its action context as a second argument, which the
  // Auth.js type does not declare.
  sendVerificationRequest: (async (
    { identifier, token }: { identifier: string; token: string },
    ctx: ActionCtx,
  ) => {
    // Convex Auth keeps the email as typed. Key the limit on the normalized
    // address so case and spacing variants share it; the client sends the
    // same normalized email in both steps.
    const email = identifier.trim().toLowerCase();
    await ctx.runMutation(internal.passwordReset.allowSend, { email });
    await sendResetEmail(email, token);
  }) as unknown as Parameters<typeof Resend>[0]["sendVerificationRequest"],
});

export const allowSend = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    await rateLimit(ctx, `reset:${email}`, SENDS_PER_WINDOW, SEND_WINDOW_MS);
  },
});

/** Uniform random digits (rejection sampling, so no digit is favored). */
export function randomDigits(length: number) {
  const limit = Math.floor(0x1_0000_0000 / 10) * 10;
  const word = new Uint32Array(1);
  let digits = "";
  while (digits.length < length) {
    crypto.getRandomValues(word);
    if (word[0] < limit) digits += String(word[0] % 10);
  }
  return digits;
}

async function sendResetEmail(email: string, code: string) {
  if (process.env.AUTH_EMAIL_LOG_CODES === "true") {
    console.log(`Password reset code for ${email}: ${code}`);
    return;
  }
  const key = process.env.AUTH_RESEND_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!key || !from) {
    console.error("AUTH_RESEND_KEY and AUTH_EMAIL_FROM must be set");
    fail("EMAIL_UNAVAILABLE");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${code} is your Bling password reset code`,
      text: resetText(code),
      html: resetHtml(code),
    }),
  });
  if (!response.ok) {
    console.error(
      `Resend returned ${response.status}: ${await response.text()}`,
    );
    fail("EMAIL_UNAVAILABLE");
  }
}

function resetText(code: string) {
  return [
    `Your Bling password reset code is ${code}.`,
    "",
    `Enter it on the reset page within ${CODE_MINUTES} minutes.`,
    "If you didn't ask to reset your password, you can ignore this email; your password hasn't changed.",
  ].join("\n");
}

// Email clients ignore stylesheets and CSS variables, so the brand colors
// are written inline here (tokens.css --accent and --mauve).
function resetHtml(code: string) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f4f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#52414c">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
    <p style="margin:0 0 24px;font-size:20px;font-weight:800;color:#e3655b">Bling</p>
    <p style="margin:0 0 16px;font-size:16px">Your password reset code:</p>
    <p style="margin:0 0 24px;font-size:32px;font-weight:800;letter-spacing:6px">${code}</p>
    <p style="margin:0 0 16px;font-size:14px">Enter it on the reset page within ${CODE_MINUTES} minutes.</p>
    <p style="margin:0;font-size:13px;color:#596157">If you didn't ask to reset your password, you can ignore this email; your password hasn't changed.</p>
  </div>
</body></html>`;
}
