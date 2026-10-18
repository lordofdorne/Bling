import { useState } from "react";
import { Check, Headphones, Mic, MicOff, Play, Volume2 } from "lucide-react";
import { useControlSize } from "../../lib/design";
import { canRecordSample, useMicrophoneCheck } from "../../lib/microphone";
import { SectionHeader } from "../page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// An optional check before opening the Hotline: pick a microphone, watch it
// pick up your voice, and hear a short recording back. Nothing here blocks
// going live. The chosen microphone is remembered and used for calls.

const TIPS = [
  {
    icon: Headphones,
    text: "Wear headphones so callers don't hear themselves echo.",
  },
  { icon: Volume2, text: "Find a quiet room and silence notifications." },
  { icon: Check, text: "Keep this tab open while you're live." },
];

/** Meter level above which the creator is clearly being heard. */
const HEARD_LEVEL = 0.12;

export function PreShowCheck() {
  const mic = useMicrophoneCheck();
  const controlSize = useControlSize();
  const [checked, setChecked] = useState(false);
  const [heard, setHeard] = useState(false);
  if (mic.level > HEARD_LEVEL && !heard) setHeard(true);

  const open = mic.status === "requesting" || mic.status === "ready";
  const finish = () => {
    mic.stop();
    setChecked(true);
  };

  return (
    <Card aria-label="Pre-show check">
      <CardContent className="flex flex-col gap-(--card-gap)">
        <div className="flex flex-col gap-3 tablet:flex-row tablet:items-start tablet:justify-between">
          <SectionHeader
            title="Pre-show check"
            description="Test your microphone before you open the line."
          />
          {checked && !open ? (
            <Badge variant="success" className="w-fit">
              <Check className="size-3" />
              Mic checked
            </Badge>
          ) : (
            <Badge variant="secondary" className="w-fit">
              Optional
            </Badge>
          )}
        </div>

        {!open && (
          <Button
            variant="secondary"
            size={controlSize}
            type="button"
            className="w-full tablet:w-fit"
            onClick={() => {
              setHeard(false);
              void mic.start();
            }}
          >
            <Mic className="size-4" />
            {checked ? "Check again" : "Check my mic"}
          </Button>
        )}

        {mic.status === "requesting" && (
          <p className="text-muted-foreground text-sm">
            Allow microphone access in your browser…
          </p>
        )}

        {mic.status === "denied" && (
          <Alert variant="destructive">
            <MicOff />
            <AlertDescription>
              Microphone access is blocked. Allow it in your browser's site
              settings, then check again. Callers can't hear you without it.
            </AlertDescription>
          </Alert>
        )}

        {mic.status === "unavailable" && (
          <Alert variant="destructive">
            <MicOff />
            <AlertDescription>
              No microphone found. Plug one in or pick another device, then
              check again.
            </AlertDescription>
          </Alert>
        )}

        {mic.status === "ready" && (
          <div className="flex flex-col gap-(--card-gap)">
            {mic.devices.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="pre-show-microphone">Microphone</Label>
                <Select
                  value={mic.deviceId ?? undefined}
                  onValueChange={(id) => {
                    setHeard(false);
                    void mic.chooseDevice(id);
                  }}
                >
                  <SelectTrigger
                    id="pre-show-microphone"
                    className="w-full min-w-0"
                  >
                    <SelectValue placeholder="Default microphone" />
                  </SelectTrigger>
                  <SelectContent>
                    {mic.devices.map((device, index) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${index + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-(length:--text-meta)">
                  Calls use this microphone.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label id="pre-show-level">Input level</Label>
                <span
                  className="text-muted-foreground text-(length:--text-meta)"
                  aria-live="polite"
                >
                  {heard ? "We can hear you" : "Say something…"}
                </span>
              </div>
              <Progress
                aria-labelledby="pre-show-level"
                value={Math.round(mic.level * 100)}
              />
            </div>

            <ul className="flex flex-col gap-2">
              {TIPS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2 text-sm">
                  <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">{text}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2 tablet:flex-row tablet:justify-end">
              {canRecordSample && (
                <Button
                  variant="secondary"
                  size={controlSize}
                  type="button"
                  className="w-full tablet:w-auto"
                  disabled={mic.sample !== "idle"}
                  onClick={mic.recordSample}
                >
                  <Play className="size-4" />
                  {mic.sample === "recording"
                    ? "Recording 5 seconds…"
                    : mic.sample === "playing"
                      ? "Playing back…"
                      : "Record & play back"}
                </Button>
              )}
              <Button
                size={controlSize}
                type="button"
                className="w-full tablet:w-auto"
                onClick={finish}
              >
                <Check className="size-4" />
                Done
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
