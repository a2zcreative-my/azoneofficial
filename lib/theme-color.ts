/**
 * v1.124.0 — keep <meta name="theme-color"> in step with the theme.
 *
 * app/layout.tsx declares the tag once, at build time, with the light value.
 * That is right for every public page (they are light only) and wrong for the
 * portal, which the CEO installs to the home screen: switching the portal to
 * dark repainted the whole app except the phone's status bar, which stayed
 * brand navy — a bright band above a dark screen, on the one surface a static
 * meta tag cannot follow.
 *
 * The colour itself is NOT decided here. `--browser-theme-color` lives in
 * styles/globals.css beside the theme it belongs to, with a value in the light
 * block and a value in `.dark`; this reads whichever one is in force. So a
 * future theme (the pink brand block, say) gets correct browser chrome by
 * declaring the variable, with no change to this file and no second copy of a
 * hex value to keep in step.
 *
 * Call it AFTER the `dark` class has been toggled — it reads computed style,
 * so the class must already be on the element.
 */
export function syncThemeColor(): void {
  if (typeof document === "undefined") return;
  const colour = getComputedStyle(document.documentElement)
    .getPropertyValue("--browser-theme-color")
    .trim();
  if (!colour) return; // stylesheet not applied yet — leave the build-time value
  /* There can be more than one theme-color tag (a browser picks the first that
     matches its media query). We only own the unconditional one Next renders
     from the viewport export; any media-scoped tag is left alone. */
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  if (meta.content !== colour) meta.content = colour;
}
