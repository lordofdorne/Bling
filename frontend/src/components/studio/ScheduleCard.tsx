import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClock } from "lucide-react";
import { useControlSize } from "../../lib/design";
import { scheduleSchema, type ScheduleValues } from "../../lib/schemas";
import {
  schedulingAvailable,
  useScheduleShow,
  type HotlineShow,
} from "../../lib/shows";
import { FormError, TextField } from "../form-fields";
import { SectionHeader } from "../page";
import { formatDateTime, toDateTimeInput } from "./format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";

// Announces when a draft Hotline will open. Fans see it on the creator's
// page and can add it to their calendar; the creator still opens the
// Hotline themselves when the time comes.

export function ScheduleCard({
  show,
  username,
}: {
  show: HotlineShow;
  username: string;
}) {
  const schedule = useScheduleShow();
  const [editing, setEditing] = useState(false);
  const scheduledFor = show.scheduledFor ? new Date(show.scheduledFor) : null;

  if (!schedulingAvailable) return null;

  const save = (when: Date | null) =>
    schedule.mutateAsync({ showID: show.id, scheduledFor: when });

  return (
    <Card aria-label="Schedule">
      <CardContent className="flex flex-col gap-(--card-gap)">
        <SectionHeader
          title="Schedule"
          description={`Tell fans when you'll open. They'll see it on /u/${username}; you still open the Hotline yourself.`}
        />
        {scheduledFor && !editing ? (
          <div className="flex flex-col gap-(--card-gap) tablet:flex-row tablet:items-center tablet:justify-between">
            <div className="flex items-center gap-3">
              <span className="bg-muted text-[var(--sand-text)] grid size-10 shrink-0 place-items-center rounded-lg">
                <CalendarClock className="size-5" />
              </span>
              <div className="min-w-0">
                <span className="text-muted-foreground block text-(length:--text-meta)">
                  Opens
                </span>
                <strong className="block font-semibold">
                  {formatDateTime(scheduledFor)}
                </strong>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 tablet:flex-row">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={schedule.isPending}
                onClick={() => void save(null).catch(() => {})}
              >
                Remove
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setEditing(true)}
              >
                Change
              </Button>
            </div>
          </div>
        ) : (
          <ScheduleForm
            initial={scheduledFor}
            pending={schedule.isPending}
            onCancel={scheduledFor ? () => setEditing(false) : undefined}
            onSave={async (when) => {
              await save(when);
              setEditing(false);
            }}
          />
        )}
        <FormError error={schedule.error} />
      </CardContent>
    </Card>
  );
}

function ScheduleForm({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  initial: Date | null;
  pending: boolean;
  onSave: (when: Date) => Promise<void>;
  onCancel?: () => void;
}) {
  const controlSize = useControlSize();
  const form = useForm<ScheduleValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { when: initial ? toDateTimeInput(initial) : "" },
  });

  const submit = form.handleSubmit(async ({ when }) => {
    try {
      await onSave(new Date(when));
    } catch {
      // The card renders the server's message.
    }
  });

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-(--card-gap) tablet:flex-row tablet:items-end"
        onSubmit={submit}
        noValidate
      >
        <TextField
          control={form.control}
          name="when"
          label="Opens at"
          type="datetime-local"
          min={toDateTimeInput(new Date())}
          className="min-w-0 flex-1"
        />
        <div className="flex flex-col-reverse gap-2 tablet:flex-row">
          {onCancel && (
            <Button
              variant="secondary"
              size={controlSize}
              type="button"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          <Button size={controlSize} type="submit" disabled={pending}>
            {pending ? "Saving…" : "Announce"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
