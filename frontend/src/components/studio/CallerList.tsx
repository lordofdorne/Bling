import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Heart,
  Repeat,
  Search,
  Shuffle,
  Sparkles,
  StickyNote,
} from "lucide-react";
import {
  useActiveCall,
  useSelectCaller,
  useSelectRandomCaller,
} from "../../lib/calls";
import {
  type QueueEntry,
  useCreatorQueue,
  useQueueEvents,
  useSaveCallerNote,
} from "../../lib/queue";
import { callerNoteSchema, type CallerNoteValues } from "../../lib/schemas";
import { CallAudioPanel } from "../CallAudioPanel";
import { FormError, TextareaField } from "../form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCallLength, formatPrice } from "./format";
import { SectionHeader } from "../page";
import { useControlSize } from "../../lib/design";

// Filters over what the creator knows about each caller. They narrow the list
// the creator picks from; none of them orders it or picks for them.
const FILTERS = [
  { id: "all", label: "All", matches: () => true },
  {
    id: "followers",
    label: "Followers",
    matches: (entry: QueueEntry) => Boolean(entry.caller?.follower),
  },
  {
    id: "new",
    label: "New",
    matches: (entry: QueueEntry) => entry.caller?.pastCalls === 0,
  },
  {
    id: "returning",
    label: "Returning",
    matches: (entry: QueueEntry) => (entry.caller?.pastCalls ?? 0) > 0,
  },
] as const;
type FilterID = (typeof FILTERS)[number]["id"];

export function CallerList({ showID }: { showID: string }) {
  const queue = useCreatorQueue(showID);
  const activeCall = useActiveCall(showID);
  const selectCaller = useSelectCaller(showID);
  const selectRandom = useSelectRandomCaller(showID);
  const controlSize = useControlSize();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterID>("all");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  useQueueEvents(showID, "creator", true);
  const entries = useMemo(() => queue.data ?? [], [queue.data]);
  const sortedEntries = useMemo(
    () =>
      [...entries].sort(
        (left, right) =>
          right.priorityRank - left.priorityRank ||
          left.joinedAt.localeCompare(right.joinedAt),
      ),
    [entries],
  );
  // Only the Convex backend knows callers across shows.
  const hasInsight = entries.some((entry) => entry.caller);
  const activeFilter =
    FILTERS.find((option) => option.id === filter) ?? FILTERS[0];
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleEntries = useMemo(
    () =>
      sortedEntries.filter(
        (entry) =>
          activeFilter.matches(entry) &&
          (!normalizedSearch ||
            [
              entry.displayName,
              entry.topic,
              entry.tierName,
              entry.caller?.note ?? "",
            ].some((value) =>
              value.toLocaleLowerCase().includes(normalizedSearch),
            )),
      ),
    [activeFilter, normalizedSearch, sortedEntries],
  );
  const filtered = visibleEntries.length !== entries.length;

  if (queue.isPending || activeCall.isPending)
    return (
      <p className="text-muted-foreground text-sm">Loading caller queue…</p>
    );
  if (queue.isError || activeCall.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>Unable to load the caller queue.</AlertDescription>
      </Alert>
    );

  const call = activeCall.data;
  return (
    <section
      className="flex flex-col gap-(--stack-gap)"
      aria-label="Caller requests"
    >
      <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <SectionHeader
          title="Caller requests"
          description={`${entries.length} waiting`}
        />
        {!call && entries.length > 0 && (
          <Button
            variant="secondary"
            size={controlSize}
            className="w-full tablet:w-auto"
            type="button"
            onClick={() => selectRandom.mutate(undefined)}
            disabled={selectRandom.isPending}
          >
            <Shuffle className="size-4" />
            {selectRandom.isPending ? "Choosing…" : "Pick a random caller"}
          </Button>
        )}
      </div>

      {call && (
        <Card className="border-primary/40" aria-label="Active call">
          <CardContent className="flex flex-col gap-2">
            <Badge variant="secondary" className="w-fit">
              {call.status.replace("_", " ")}
            </Badge>
            <strong className="text-base">{call.caller.displayName}</strong>
            <p className="text-muted-foreground text-sm">{call.caller.topic}</p>
            <span className="text-muted-foreground text-xs">
              {call.caller.tierName} ·{" "}
              {formatCallLength(call.callDurationSeconds)} reserved
            </span>
            {call.status === "PAYMENT_PENDING" ? (
              <p className="text-muted-foreground text-sm">
                Stripe is confirming the charge. Audio stays closed until
                capture succeeds.
              </p>
            ) : (
              <CallAudioPanel call={call} role="creator" />
            )}
          </CardContent>
        </Card>
      )}

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Share your public URL. Callers will appear here.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 basis-48 flex-1">
              <span className="sr-only">Search caller requests</span>
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                type="search"
                aria-label="Search caller requests"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={
                  hasInsight
                    ? "Search name, topic, tier, or note"
                    : "Search name, topic, or tier"
                }
                autoComplete="off"
                className="pl-9"
              />
            </div>
            <span className="text-muted-foreground text-xs" aria-live="polite">
              {filtered
                ? `${visibleEntries.length} of ${entries.length}`
                : `${entries.length} requests`}
            </span>
          </div>

          {hasInsight && (
            <Tabs
              value={filter}
              onValueChange={(value) => setFilter(value as FilterID)}
            >
              <TabsList className="w-full" aria-label="Filter callers">
                {FILTERS.map((option) => (
                  <TabsTrigger
                    key={option.id}
                    value={option.id}
                    className="max-tablet:gap-1 max-tablet:px-1 max-tablet:text-(length:--text-meta)"
                  >
                    {option.label}
                    <span className="text-muted-foreground font-normal tabular-nums">
                      {entries.filter(option.matches).length}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {visibleEntries.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-(--space-9) text-center">
              <Search className="size-5" />
              <strong className="text-foreground">No matching callers</strong>
              <span className="text-sm">
                {filter === "all"
                  ? "Try another name, topic, or tier."
                  : "Try another search or filter."}
              </span>
            </div>
          ) : (
            <ol className="flex flex-col gap-2">
              {visibleEntries.map((entry) => (
                <CallerRow
                  key={entry.id}
                  entry={entry}
                  showID={showID}
                  editingNote={editingNote === entry.id}
                  onEditNote={(editing) =>
                    setEditingNote(editing ? entry.id : null)
                  }
                  onSelect={() => selectCaller.mutate(entry.id)}
                  selectDisabled={Boolean(call) || selectCaller.isPending}
                />
              ))}
            </ol>
          )}
        </>
      )}

      {(selectCaller.isError || selectRandom.isError) && (
        <Alert variant="destructive">
          <AlertDescription>
            Unable to update the active call. Refresh and try again.
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

function CallerRow({
  entry,
  showID,
  editingNote,
  onEditNote,
  onSelect,
  selectDisabled,
}: {
  entry: QueueEntry;
  showID: string;
  editingNote: boolean;
  onEditNote: (editing: boolean) => void;
  onSelect: () => void;
  selectDisabled: boolean;
}) {
  const insight = entry.caller;
  return (
    <li className="hover:bg-accent/50 flex flex-col gap-3 rounded-xl border p-(--inset-pad) transition-colors">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 basis-48 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="min-w-0 truncate text-sm font-semibold">
              {entry.displayName}
            </strong>
            {insight && <CallerTags insight={insight} />}
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">{entry.topic}</p>
          <span className="text-muted-foreground mt-1 block text-xs">
            {entry.tierName} · {formatCallLength(entry.callDurationSeconds)} ·{" "}
            {entry.tierPriceCents > 0
              ? `${formatPrice(entry.tierPriceCents)} authorized`
              : "Free"}
          </span>
          {insight?.note && !editingNote && (
            <p className="text-foreground mt-2 flex items-start gap-1.5 text-sm">
              <StickyNote
                className="text-(--sand-text) mt-0.5 size-4 shrink-0"
                aria-label="Your note"
              />
              <span className="min-w-0 break-words whitespace-pre-line">
                {insight.note}
              </span>
            </p>
          )}
        </div>
        <div className="flex w-full flex-col gap-2 tablet:w-auto tablet:flex-row">
          {insight && !editingNote && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="w-full tablet:w-auto"
              onClick={() => onEditNote(true)}
              aria-label={`${insight.note ? "Edit" : "Add"} note for ${entry.displayName}`}
            >
              <StickyNote className="size-4" />
              {insight.note ? "Edit note" : "Add note"}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="w-full tablet:w-auto"
            type="button"
            onClick={onSelect}
            disabled={selectDisabled}
          >
            Select caller
          </Button>
        </div>
      </div>
      {insight && editingNote && (
        <CallerNoteForm
          entry={entry}
          showID={showID}
          note={insight.note}
          onDone={() => onEditNote(false)}
        />
      )}
    </li>
  );
}

function CallerTags({
  insight,
}: {
  insight: NonNullable<QueueEntry["caller"]>;
}) {
  return (
    <>
      {insight.follower && (
        <Badge variant="secondary">
          <Heart className="size-3" />
          Follower
        </Badge>
      )}
      {insight.pastCalls === 0 ? (
        <Badge variant="outline">
          <Sparkles className="size-3" />
          First call
        </Badge>
      ) : (
        <Badge variant="outline">
          <Repeat className="size-3" />
          {insight.pastCalls >= 10
            ? "10+ calls"
            : insight.pastCalls === 1
              ? "Called once"
              : `${insight.pastCalls} calls`}
        </Badge>
      )}
    </>
  );
}

/** A private note about the caller, kept for this creator across shows. */
function CallerNoteForm({
  entry,
  showID,
  note,
  onDone,
}: {
  entry: QueueEntry;
  showID: string;
  note: string;
  onDone: () => void;
}) {
  const save = useSaveCallerNote(showID);
  const form = useForm<CallerNoteValues>({
    resolver: zodResolver(callerNoteSchema),
    defaultValues: { note },
  });
  const submit = form.handleSubmit(async (values) => {
    await save.mutateAsync({ entryId: entry.id, note: values.note });
    onDone();
  });

  return (
    <Form {...form}>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => void submit(event).catch(() => {})}
      >
        <TextareaField
          control={form.control}
          name="note"
          label={`Note about ${entry.displayName}`}
          description="Only you see this. It stays with this caller on future shows."
          rows={3}
          maxLength={500}
          autoFocus
          enterKeyHint="done"
        />
        <FormError error={save.error} fallback="Unable to save the note." />
        <div className="flex flex-col gap-2 tablet:flex-row tablet:justify-end">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="w-full tablet:w-auto"
            onClick={onDone}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            className="w-full tablet:w-auto"
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save note"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
