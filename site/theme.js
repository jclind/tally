// Light or dark. The visitor's choice from the header button wins; until they make one, the page follows their device.
// It runs in <head>, before the page draws, so the page never flashes the wrong mode.
(() => {
  const root = document.documentElement;
  const device = matchMedia("(prefers-color-scheme: dark)");
  let choice = null;
  try { choice = localStorage.getItem("theme"); } catch {}
  const apply = () => {
    const dark = (choice || (device.matches ? "dark" : "light")) === "dark";
    root.dataset.theme = dark ? "dark" : "light";
    // Screenshots pick their dark twin with a media query, which only sees the device, so point it at the mode in use.
    for (const s of document.querySelectorAll("source[data-media], source[media*='prefers-color-scheme']")) {
      s.dataset.media ??= s.media;
      const media = s.dataset.media.replace(/\(prefers-color-scheme:\s*dark\)/, dark ? "(min-width: 0px)" : "(max-width: 0px)");
      if (s.media === media) continue;
      s.media = media;
      // Chrome doesn't pick a picture's source again when only a media attribute changes; setting src again makes it.
      const img = s.parentElement.querySelector("img");
      if (img) img.src = img.getAttribute("src");
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#104F4E" : "#136564";
    const b = document.querySelector(".theme");
    if (b) b.setAttribute("aria-label", dark ? "Use light mode" : "Use dark mode");
  };
  apply();
  device.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.querySelector(".theme")?.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      // Picking what the device already uses clears the choice, so the page follows the device again.
      choice = next === (device.matches ? "dark" : "light") ? null : next;
      try { if (choice) localStorage.setItem("theme", choice); else localStorage.removeItem("theme"); } catch {}
      apply();
    });
  });
})();
