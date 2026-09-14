import "@testing-library/jest-dom/vitest";
import "../tokens.css";

afterEach(() => {
  localStorage.removeItem("bling-theme");
  document.documentElement.removeAttribute("data-theme");
});
