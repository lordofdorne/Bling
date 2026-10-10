import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Safety net only: every refund and capture schedules its own work. This
// picks up anything whose scheduled action died.
crons.interval("payments sweep", { minutes: 1 }, internal.refunds.sweep, {});

// Monthly creator payouts. Hourly, like the Go worker: it does nothing unless
// CREATOR_PAYOUTS_ENABLED=true, and from the payout day on it reserves and
// transfers each eligible creator's balance once per month.
crons.interval("creator payouts", { hours: 1 }, internal.payouts.runDue, {});

// Notifications older than 30 days, with their read receipts. Queries already
// hide them, so this only reclaims space.
crons.interval(
  "notification retention",
  { minutes: 10 },
  internal.notifications.prune,
  {},
);

export default crons;
