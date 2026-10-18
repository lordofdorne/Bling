import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireCreatorId } from "./lib/auth";
import { fail } from "./lib/errors";
import { showForCreator } from "./shows";

// A creator's private notes about callers. The creator names a queue entry
// from their list; the note is kept against that entry's caller, so it shows
// up again whenever the same person waits on a later show. Callers never see
// notes, and the client never learns a caller's account id.

const MAX_NOTE_LENGTH = 500;

/** Saves the note for the caller behind a queue entry. Empty deletes it. */
export const save = mutation({
  args: { entryId: v.id("queueEntries"), note: v.string() },
  handler: async (ctx, args) => {
    const creatorId = await requireCreatorId(ctx);
    const entry = await ctx.db.get(args.entryId);
    if (!entry) fail("NOT_IN_QUEUE");
    await showForCreator(ctx, entry.showId, creatorId);

    const note = args.note.trim();
    if (note.length > MAX_NOTE_LENGTH) {
      fail(
        "VALIDATION_FAILED",
        `Notes must be ${MAX_NOTE_LENGTH} characters or fewer.`,
      );
    }
    const existing = await ctx.db
      .query("callerNotes")
      .withIndex("by_creator_viewer", (q) =>
        q.eq("creatorId", creatorId).eq("viewerId", entry.viewerId),
      )
      .first();
    if (!note) {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) {
      await ctx.db.patch(existing._id, { note, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("callerNotes", {
        creatorId,
        viewerId: entry.viewerId,
        note,
        updatedAt: Date.now(),
      });
    }
    return { note };
  },
});
