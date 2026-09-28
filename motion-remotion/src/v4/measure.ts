// v4 verification helper (design-v4 §5): measures on-screen sizes in the
// rendered page itself — getBoundingClientRect() includes every 3D transform
// and the perspective divide — and logs one JSON line per still to the
// browser console (Remotion forwards it to the CLI). Only runs with
// `measure: true`; it never changes what is drawn.

const ownText = (el: Element) =>
  Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? '')
    .join('')
    .trim();

const findByText = (text: string, within?: string): HTMLElement | null => {
  const root: ParentNode = (within ? document.querySelector(within) : null) ?? document;
  const all = Array.from(root.querySelectorAll<HTMLElement>('div, span'));
  return all.find((el) => ownText(el) === text) ?? null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export interface TextTarget {
  label: string;
  text: string;
  pill?: boolean; // also report the containing pill's on-screen height (chips/badges)
  within?: string; // CSS selector to search inside (e.g. the hero card)
}

export const measureStill = (still: string, targets: TextTarget[]) => {
  const out: Record<string, unknown> = {still};
  for (const t of targets) {
    const el = findByText(t.text, t.within);
    if (!el) {
      out[t.label] = 'NOT FOUND';
      continue;
    }
    const rect = el.getBoundingClientRect();
    const layoutH = el.offsetHeight || (el as HTMLElement).getBoundingClientRect().height;
    const cssFont = parseFloat(getComputedStyle(el).fontSize);
    const scale = rect.height / layoutH;
    const entry: Record<string, number | number[]> = {
      cssFontPx: r1(cssFont),
      screenScale: Math.round(scale * 1000) / 1000,
      screenFontPx: r1(cssFont * scale),
      rect: [r1(rect.left), r1(rect.top), r1(rect.right), r1(rect.bottom)],
    };
    if (t.pill && el.parentElement) {
      const pr = el.parentElement.getBoundingClientRect();
      entry.pillScreenH = r1(pr.height);
      entry.pillScreenW = r1(pr.width);
      entry.pillLeft = r1(pr.left);
      entry.pillRight = r1(pr.right);
      entry.pillTop = r1(pr.top);
      entry.pillBottom = r1(pr.bottom);
    }
    out[t.label] = entry;
  }
  const d3 = document.querySelector('[data-v4="debug-3d"]');
  const d2 = document.querySelector('[data-v4="debug-2d"]');
  if (d3 && d2) {
    const a = d3.getBoundingClientRect();
    const b = d2.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    out.anchorDebug = {dot3d: [r1(ax), r1(ay)], ring2d: [r1(bx), r1(by)], errPx: Math.round(Math.hypot(ax - bx, ay - by) * 100) / 100};
  }
  const dots = document.querySelectorAll('[data-v4="callout-dot"]');
  document.querySelectorAll('[data-v4="callout-chip"]').forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const d = dots[i]?.getBoundingClientRect();
    out[`callout${i}`] = {
      chip: [r1(r.left), r1(r.top), r1(r.right), r1(r.bottom)],
      dot: d ? [r1(d.left + d.width / 2), r1(d.top + d.height / 2)] : null,
    };
  });
  const hero = document.querySelector('[data-v4="hero"]');
  if (hero) {
    const r = hero.getBoundingClientRect();
    out.heroCard = [r1(r.left), r1(r.top), r1(r.right), r1(r.bottom)];
  }
  // eslint-disable-next-line no-console
  console.log('V4MEASURE ' + JSON.stringify(out));
};
