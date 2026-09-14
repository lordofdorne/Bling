import { useTheme } from "../lib/ThemeProvider";
import type { ThemePreference } from "../lib/theme";

const OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "dark", label: "Dark", hint: "Dim olive studio" },
  { value: "light", label: "Light", hint: "Warm paper" },
  { value: "system", label: "System", hint: "Match this device" },
];

export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return (
    <fieldset className="theme-switch">
      <legend className="sr-only">Color theme</legend>
      <div className="theme-switch-options">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`theme-option${preference === option.value ? " selected" : ""}`}
          >
            <input
              className="sr-only"
              type="radio"
              name="color-theme"
              value={option.value}
              checked={preference === option.value}
              onChange={() => setPreference(option.value)}
            />
            <strong>{option.label}</strong>
            <span>{option.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
