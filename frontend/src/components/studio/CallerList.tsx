import { useMemo, useState } from "react";
import { Search, Shuffle } from "lucide-react";
import {
  useActiveCall,
  useSelectCaller,
  useSelectRandomCaller,
} from "../../lib/calls";
import { useCreatorQueue, useQueueEvents } from "../../lib/queue";
import { CallAudioPanel } from "../CallAudioPanel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCallLength, formatPrice } from "./format";

export function CallerList({ showID }: { showID: string }) {
  const queue = useCreatorQueue(showID);
  const activeCall = useActiveCall(showID);
  const selectCaller = useSelectCaller(showID);
  const selectRandom = useSelectRandomCaller(showID);
  const [search, setSearch] = useState("");
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
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleEntries = useMemo(
    () =>
      normalizedSearch
        ? sortedEntries.filter((entry) =>
            [entry.displayName, entry.topic, entry.tierName].some((value) =>
              value.toLocaleLowerCase().includes(normalizedSearch),
            ),
          )
        : sortedEntries,
    [normalizedSearch, sortedEntries],
  );

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
    <section className="flex flex-col gap-4" aria-label="Caller requests">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-bold">Caller requests</h2>
          <span className="text-muted-foreground text-sm">
            {entries.length} waiting
          </span>
        </div>
        {!call && entries.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
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
            <div className="relative min-w-[220px] flex-1">
              <span className="sr-only">Search caller requests</span>
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                type="search"
                aria-label="Search caller requests"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, topic, or tier"
                autoComplete="off"
                className="pl-9"
              />
            </div>
            <span className="text-muted-foreground text-xs" aria-live="polite">
              {visibleEntries.length === entries.length
                ? `${entries.length} requests`
                : `${visibleEntries.length} of ${entries.length}`}
            </span>
          </div>

          {visibleEntries.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center">
              <Search className="size-5" />
              <strong className="text-foreground">No matching callers</strong>
              <span className="text-sm">Try another name, topic, or tier.</span>
            </div>
          ) : (
            <ol className="flex flex-col gap-2">
              {visibleEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="hover:bg-accent/50 flex flex-wrap items-center gap-3 rounded-xl border p-4 transition-colors"
                >
                  <div className="min-w-[200px] flex-1">
                    <strong className="text-sm font-semibold">
                      {entry.displayName}
                    </strong>
                    <p className="text-muted-foreground mt-0.5 text-sm">
                      {entry.topic}
                    </p>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {entry.tierName} ·{" "}
                      {formatCallLength(entry.callDurationSeconds)} ·{" "}
                      {entry.tierPriceCents > 0
                        ? `${formatPrice(entry.tierPriceCents)} authorized`
                        : "Free"}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => selectCaller.mutate(entry.id)}
                    disabled={Boolean(call) || selectCaller.isPending}
                  >
                    Select caller
                  </Button>
                </li>
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
