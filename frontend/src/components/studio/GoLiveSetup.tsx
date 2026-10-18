import type { HotlineShow } from "../../lib/shows";
import { SectionHeader } from "../page";
import { MicCheckRow } from "./PreShowCheck";
import { ScheduleRow } from "./ScheduleCard";
import { Card, CardContent } from "@/components/ui/card";

// Optional steps before opening a draft Hotline, as compact rows in one card.
// Each row says what it does; nothing here blocks going live.

export function GoLiveSetup({ show }: { show: HotlineShow }) {
  return (
    <Card aria-label="Before you go live">
      <CardContent className="flex flex-col gap-(--stack-gap)">
        <SectionHeader title="Before you go live" />
        <div className="divide-y">
          <ScheduleRow show={show} />
          <MicCheckRow />
        </div>
      </CardContent>
    </Card>
  );
}
