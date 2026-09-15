import { useMemo } from "react";
import { readDesignTokens, type DesignTokens } from "./layout";
import { useScreenSize } from "./ScreenSizeProvider";
import { useTheme } from "./ThemeProvider";

export function useDesignTokens(): DesignTokens {
  const { resolved } = useTheme();
  const { name } = useScreenSize();
  return useMemo(() => {
    void resolved;
    void name;
    return readDesignTokens();
  }, [resolved, name]);
}

export function useControlSize(): "sm" | "md" | "lg" {
  const { isPhone } = useScreenSize();
  return isPhone ? "lg" : "md";
}
