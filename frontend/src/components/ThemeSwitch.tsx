import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/ThemeProvider";
import type { ThemePreference } from "../lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: {
  value: ThemePreference;
  label: string;
  hint: string;
  Icon: typeof Sun;
}[] = [
  { value: "dark", label: "Dark", hint: "Dim olive studio", Icon: Moon },
  { value: "light", label: "Light", hint: "Warm paper", Icon: Sun },
  {
    value: "system",
    label: "System",
    hint: "Match this device",
    Icon: Monitor,
  },
];

export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return (
    <fieldset>
      <legend className="sr-only">Color theme</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "relative flex cursor-pointer flex-col gap-1 rounded-xl border p-4 transition-colors",
                selected ? "border-primary bg-primary/5" : "hover:bg-accent",
              )}
            >
              <input
                className="sr-only"
                type="radio"
                name="color-theme"
                value={option.value}
                checked={selected}
                onChange={() => setPreference(option.value)}
              />
              <option.Icon className="text-muted-foreground size-4" />
              <strong className="text-sm font-semibold">{option.label}</strong>
              <span className="text-muted-foreground text-xs">
                {option.hint}
              </span>
              {selected && (
                <Check className="text-primary absolute top-4 right-4 size-4" />
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
