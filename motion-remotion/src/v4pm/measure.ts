import {poseFor, headlines, type Still} from './content';
import {COPY, headlineLength} from '../v4/config';

// 렌더된 DOM에서 크기와 가림을 관찰한다. 회전 시작은 크기 기준 예외다.
export const measureFrame = (still: Still, rise: number) => {
  const rect = (el: Element) => el.getBoundingClientRect();
  const round = (n: number) => Math.round(n * 100) / 100;
  if (still === 'OH') {
    const headline = document.querySelector<HTMLElement>('[data-pm-headline] > div')!;
    const words = Array.from(headline.querySelectorAll('span')).filter(el => el.children.length === 0).map(rect);
    const center = [round((Math.min(...words.map(r => r.left)) + Math.max(...words.map(r => r.right))) / 2), round((Math.min(...words.map(r => r.top)) + Math.max(...words.map(r => r.bottom))) / 2)];
    if (Math.abs(center[0] - 960) > 1 || Math.abs(center[1] - 540) > 1) throw new Error('오프닝 카피 중앙 배치 실패');
    console.log('V4PMMEASURE ' + JSON.stringify({still, headlineLength: headlineLength(COPY.opening3), center, fontSize: parseFloat(getComputedStyle(headline).fontSize), boardTextCount: document.querySelectorAll('[data-pm-text]').length}));
    return;
  }
  const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const textNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-pm-text]'));
  const texts = textNodes.map(el => {
    const r = rect(el), cs = getComputedStyle(el);
    return {text: el.textContent, role: el.dataset.pmText, px: round(parseFloat(cs.fontSize) * r.height / el.offsetHeight), bounds: [r.left, r.top, r.right, r.bottom].map(round)};
  });
  const min = (role: string) => Math.min(...texts.filter(t => t.role === role).map(t => t.px));
  const chip = document.querySelector('[data-pm-chip="hero"]')!;
  const callout = document.querySelector('[data-v4="callout-chip"]');
  const dot3 = document.querySelector('[data-v4="debug-3d"]');
  const dot2 = document.querySelector('[data-v4="debug-2d"]');
  let anchorError: number | null = null;
  if (dot3 && dot2) {
    const a = rect(dot3), b = rect(dot2);
    anchorError = round(Math.hypot(a.left + a.width / 2 - b.left - b.width / 2, a.top + a.height / 2 - b.top - b.height / 2));
  }
  const clipped = texts.filter(t => t.bounds[0] < 0 || t.bounds[1] < 0 || t.bounds[2] > 1920 || t.bounds[3] > 1080).map(t => t.text);
  const headlineElements = Array.from(document.querySelectorAll<HTMLElement>('[data-pm-headline] span')).filter(el => el.textContent?.trim() && el.children.length === 0);
  const headlineOverlaps = textNodes.filter(el => headlineElements.some(h => overlaps(rect(h), rect(el)))).map(el => el.textContent);
  const calloutOverlaps = callout ? textNodes.filter(el => overlaps(rect(callout), rect(el))).map(el => el.textContent) : [];
  const overflow = textNodes.filter(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map(el => el.textContent);
  const opening = still === 'O1' || still === 'O2';
  const output = {still, rise, pose: poseFor(still), headlineLength: still === 'O1' ? 0 : headlineLength(still === 'O2' ? COPY.opening3 : headlines[still]), minBody: min('body'), minSecondary: min('secondary'), heroChipHeight: round(rect(chip).height), anchorError, clipped, headlineOverlaps, calloutOverlaps, overflow, texts};
  console.log('V4PMMEASURE ' + JSON.stringify(output));
  if (still !== 'O1' && (output.minBody < 20 || output.minSecondary < 18 || output.heroChipHeight < 36 || clipped.length || headlineOverlaps.length || calloutOverlaps.length || overflow.length)) throw new Error(`가독성 검사 실패: ${still}`);
  if (!opening && dot3 && (anchorError === null || anchorError > 1)) throw new Error(`앵커 검사 실패: ${still}`);
};
