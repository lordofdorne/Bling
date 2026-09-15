import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { spanForScreen, type SpanMap } from "../lib/layout";
import { useScreenSize } from "../lib/ScreenSizeProvider";

type GridGap = "none" | "sm" | "md" | "lg";

export function Grid({
  as: Tag = "div",
  gap = "md",
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  gap?: GridGap;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  const classes = ["bling-grid", `bling-grid-${gap}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}

export function GridItem({
  as: Tag = "div",
  className,
  children,
  span = 4,
  phone,
  tablet,
  laptop,
  desktop,
  wide,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  children?: ReactNode;
} & SpanMap &
  HTMLAttributes<HTMLElement>) {
  const { name } = useScreenSize();
  const columns = spanForScreen(name, {
    span,
    phone,
    tablet,
    laptop,
    desktop,
    wide,
  });
  return (
    <Tag
      className={["bling-grid-item", className].filter(Boolean).join(" ")}
      style={{ gridColumn: `span ${columns}` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
