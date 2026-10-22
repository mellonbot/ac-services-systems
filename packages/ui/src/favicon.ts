import { FAVICON } from "../../tokens/src/index.ts";

/**
 * Turns the tab's favicon and the masthead mark (see FAVICON in
 * packages/tokens/src/brand.ts) on one timer, so the two never drift apart.
 *
 * The frame's <link rel="icon"> is an animated PNG, and only Firefox plays an
 * animated favicon; every other browser shows its first frame. So this draws
 * the strip beside it a frame at a time onto a 32px canvas and points the link
 * at each one. The strip is resolved against the link's own href, so a
 * path-prefixed deployment needs nothing extra.
 *
 * The mark is a span whose background is the mark strip; each frame moves the
 * background one step along it.
 *
 * Under prefers-reduced-motion it draws frame 0 once and stops, which also
 * stills Firefox's own playback. Returns a function that stops the turn.
 */
export const spinFavicon = (doc: Document): (() => void) => {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const ctx = doc.createElement("canvas").getContext("2d");
  if (!link || !ctx) return () => {};
  const { px, frames, fps } = FAVICON;
  ctx.canvas.width = ctx.canvas.height = px;
  const still = doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false;
  let i = 0, timer: ReturnType<typeof setInterval> | undefined;
  const marks = Array.from(doc.querySelectorAll<HTMLElement>(".ac-mast__mark"));
  const draw = () => {
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(strip, i * px, 0, px, px, 0, 0, px, px);
    link.href = ctx.canvas.toDataURL("image/png");
    for (const m of marks) m.style.backgroundPosition = `${(i / (frames - 1)) * 100}% 0`;
    i = (i + 1) % frames;
  };
  const strip = new Image();
  strip.onload = () => {
    draw();
    if (!still) timer = setInterval(draw, 1000 / fps);
  };
  strip.src = new URL(FAVICON.strip, link.href).href;
  return () => clearInterval(timer);
};
