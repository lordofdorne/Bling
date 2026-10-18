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
import { SetupRow } from "./SetupRow";
import { formatDateTime, toDateTimeInput } from "./format";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";

// Announces when a draft Hotline will open. Fans see it on the creator's
// page and can add it to their calendar; the creator still opens the
// Hotline themselves when the time comes.

export function ScheduleRow({ show }: { show: HotlineShow }) {
  const schedule = useScheduleShow();
  const [editing, setEditing] = useState(false);
  const scheduledFor = show.scheduledFor ? new Date(show.scheduledFor) : null;

  if (!schedulingAvailable) return null;

  const save = (when: Date | null) =>
    schedule.mutateAsync({ showID: show.id, scheduledFor: when });

  return (
    <SetupRow
      label="Schedule"
      icon={CalendarClock}
      title="Schedule"
      status={
        scheduledFor ? (
          <>
            Opens{" "}
            <strong className="text-foreground font-semibold">
              {formatDateTime(scheduledFor)}
            </strong>
          </>
        ) : (
          "Let fans know when you'll open"
        )
      }
      action={
        !editing && (
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setEditing(true)}
          >
            {scheduledFor ? "Change" : "Set time"}
          </Button>
        )
      }
    >
      {editing && (
        <ScheduleForm
          initial={scheduledFor}
          pending={schedule.isPending}
          onCancel={() => setEditing(false)}
          onRemove={
            scheduledFor
              ? async () => {
                  await save(null);
                  setEditing(false);
                }
              : undefined
          }
          onSave={async (when) => {
            await save(when);
            setEditing(false);
          }}
        />
      )}
      <FormError error={schedule.error} />
    </SetupRow>
  );
}

function ScheduleForm({
  initial,
  pending,
  onSave,
  onCancel,
  onRemove,
}: {
  initial: Date | null;
  pending: boolean;
  onSave: (when: Date) => Promise<void>;
  onCancel: () => void;
  onRemove?: () => Promise<void>;
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
        <div className="flex flex-col gap-2 tablet:flex-row">
          {onRemove && (
            <Button
              variant="ghost"
              size={controlSize}
              type="button"
              disabled={pending}
              onClick={() => void onRemove().catch(() => {})}
            >
              Remove
            </Button>
          )}
          <Button
            variant="secondary"
            size={controlSize}
            type="button"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button size={controlSize} type="submit" disabled={pending}>
            {pending ? "Saving…" : "Announce"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
