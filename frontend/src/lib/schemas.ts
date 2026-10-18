import { z } from "zod";
import {
  MINIMUM_PAID_TIER_CENTS,
  centsFromPriceInput,
} from "../components/studio/format";

// Shared validation for every Bling form. Field rules live here once so the
// same email, password, or name is checked the same way on every screen, and
// they mirror what the API enforces.

export const emailField = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "Use 254 characters or fewer.")
  .pipe(z.email("Enter a valid email address."));

export const usernameField = z
  .string()
  .trim()
  .min(3, "Use at least 3 characters.")
  .max(30, "Use 30 characters or fewer.")
  .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, or underscores.");

export const newPasswordField = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(72, "Use 72 characters or fewer.");

export const currentPasswordField = z
  .string()
  .min(1, "Enter your password.")
  .max(72, "Use 72 characters or fewer.");

export const displayNameField = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(60, "Use 60 characters or fewer.");

// ---- Auth ----

export const loginSchema = z.object({
  email: emailField,
  password: currentPasswordField,
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  username: usernameField,
  email: emailField,
  password: newPasswordField,
});
export type RegisterValues = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: newPasswordField,
    confirmation: z.string().min(1, "Confirm your new password."),
  })
  .refine((values) => values.password === values.confirmation, {
    path: ["confirmation"],
    message: "Passwords do not match.",
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/** Matches RESET_CODE_LENGTH in convex/passwordReset.ts. */
export const RESET_CODE_LENGTH = 8;

export const resetWithCodeSchema = z
  .object({
    code: z
      .string()
      .transform((value) => value.replace(/\s+/g, ""))
      .pipe(
        z
          .string()
          .regex(
            new RegExp(`^\\d{${RESET_CODE_LENGTH}}$`),
            `Enter the ${RESET_CODE_LENGTH}-digit code from the email.`,
          ),
      ),
    password: newPasswordField,
    confirmation: z.string().min(1, "Confirm your new password."),
  })
  .refine((values) => values.password === values.confirmation, {
    path: ["confirmation"],
    message: "Passwords do not match.",
  });
export type ResetWithCodeValues = z.infer<typeof resetWithCodeSchema>;

// ---- Hotline schedule ----

const MINUTE = 60_000;

/**
 * When a draft Hotline opens, from a `datetime-local` input (the viewer's
 * local time). Same window as convex/shows.ts: 5 minutes to 60 days ahead.
 */
export const scheduleSchema = z.object({
  when: z
    .string()
    .min(1, "Pick a date and time.")
    .refine(
      (value) => !Number.isNaN(new Date(value).getTime()),
      "Pick a date and time.",
    )
    .refine(
      (value) => new Date(value).getTime() - Date.now() >= 5 * MINUTE,
      "Pick a time at least 5 minutes from now.",
    )
    .refine(
      (value) =>
        new Date(value).getTime() - Date.now() <= 60 * 24 * 60 * MINUTE,
      "Pick a time within the next 60 days.",
    ),
});
export type ScheduleValues = z.infer<typeof scheduleSchema>;

// ---- Creator profile ----

export const profileSchema = z.object({
  displayName: displayNameField,
  bio: z.string().max(500, "Use 500 characters or fewer."),
  avatarUrl: z.string(),
  coverUrl: z
    .string()
    .trim()
    .max(2048, "Use a shorter URL.")
    .refine((value) => value === "" || /^https:\/\/\S+$/.test(value), {
      message: "Use an https:// image URL.",
    }),
  published: z.boolean(),
});
export type ProfileValues = z.infer<typeof profileSchema>;

// ---- Caller request ----

export const callRequestSchema = z.object({
  displayName: displayNameField,
  topic: z
    .string()
    .trim()
    .min(1, "Tell the host what you want to talk about.")
    .max(280, "Use 280 characters or fewer."),
  tierId: z.string().min(1, "Choose a tier."),
  /**
   * Where a guest's receipt goes for a paid tier. Optional here because the
   * form only asks guests choosing a paid tier; it requires it then.
   */
  receiptEmail: z.union([z.literal(""), emailField]),
});
export type CallRequestValues = z.infer<typeof callRequestSchema>;

// ---- Caller note ----
// Same limit as convex/callerNotes.ts. Empty clears the note.

export const callerNoteSchema = z.object({
  note: z.string().trim().max(500, "Use 500 characters or fewer."),
});
export type CallerNoteValues = z.infer<typeof callerNoteSchema>;

// ---- Hotline tiers ----
// Duration and price stay strings while editing so a half-typed "0." or "4.5"
// is never coerced away; they are converted on submit.

export const MAX_TIERS = 5;

export const tierSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name this tier.")
      .max(40, "Use 40 characters or fewer."),
    duration: z.string().refine(
      (value) => {
        const minutes = Number(value);
        return value !== "" && minutes >= 0.5 && minutes <= 60;
      },
      { message: "Choose between 0.5 and 60 minutes." },
    ),
    paid: z.boolean(),
    price: z.string(),
    enabled: z.boolean(),
  })
  .superRefine((tier, ctx) => {
    if (!tier.paid) return;
    const cents = centsFromPriceInput(tier.price);
    if (cents === null || cents < MINIMUM_PAID_TIER_CENTS) {
      ctx.addIssue({
        code: "custom",
        path: ["price"],
        message: "Charge at least $0.50 for a paid tier.",
      });
    }
  });

export const tierConfigSchema = z.object({
  tiers: z
    .array(tierSchema)
    .min(1, "Keep at least one tier.")
    .max(MAX_TIERS, `Use ${MAX_TIERS} tiers or fewer.`),
});
export type TierValues = z.infer<typeof tierSchema>;
export type TierConfigValues = z.infer<typeof tierConfigSchema>;
