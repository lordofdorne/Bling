export function cssToken(name: `--${string}`): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

export function syncDocumentThemeColor() {
  const bg = cssToken("--bg");
  if (!bg) {
    return;
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", bg);
}
