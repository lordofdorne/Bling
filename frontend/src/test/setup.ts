import "@testing-library/jest-dom/vitest";
import "../tokens.css";

// Radix primitives measure and capture pointers; jsdom implements neither, so
// the shadcn components that build on them need these shims to render at all.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
  return false;
};
Element.prototype.setPointerCapture ??= function setPointerCapture() {};
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};

afterEach(() => {
  localStorage.removeItem("bling-theme");
  document.documentElement.removeAttribute("data-theme");
});
