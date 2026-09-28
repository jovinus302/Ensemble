import {cameraAt, heroAt, scrollAt, SEGMENTS} from './motion';

export const measureMotion = (frame: number) => {
  const r = (el: Element) => el.getBoundingClientRect();
  const round = (v: number) => Math.round(v * 100) / 100;
  const opacity = (el: Element) => {let result = 1; for (let p: Element | null = el; p; p = p.parentElement) result *= Number(getComputedStyle(p).opacity); return result;};
  const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const inView = (el: Element) => {
    if (opacity(el) < .05) return false;
    const bounds = r(el), viewport = el.closest('[data-chat-viewport]');
    return bounds.right > 0 && bounds.left < 1920 && bounds.bottom > 0 && bounds.top < 1080 && (!viewport || intersects(bounds, r(viewport)));
  };
  const texts = Array.from(document.querySelectorAll<HTMLElement>('[data-pm-text]')).filter(inView).map(el => {
    const bounds = r(el), cs = getComputedStyle(el);
    return {text: el.textContent, role: el.dataset.pmText, font: round(parseFloat(cs.fontSize) * bounds.height / el.offsetHeight), rect: [bounds.left, bounds.top, bounds.right, bounds.bottom].map(round), overflow: el.scrollWidth > el.clientWidth + 1};
  });
  const events = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-event]')).filter(inView).map(el => ({id: el.dataset.chatEvent, text: el.textContent, y: round(r(el).top), bottom: round(r(el).bottom)}));
  const headlines = Array.from(document.querySelectorAll<HTMLElement>('[data-motion-headline] span')).filter(el => el.children.length === 0 && inView(el)).map(el => ({text: el.textContent, rect: [r(el).left, r(el).top, r(el).right, r(el).bottom].map(round)}));
  const d3 = document.querySelector('[data-v4="debug-3d"]'), d2 = document.querySelector('[data-v4="debug-2d"]');
  let anchorError = null;
  if (d3 && d2) {const a = r(d3), b = r(d2); anchorError = round(Math.hypot(a.left + a.width / 2 - b.left - b.width / 2, a.top + a.height / 2 - b.top - b.height / 2));}
  const h = heroAt(frame);
  const chips = Array.from(document.querySelectorAll('[data-pm-chip="hero"]')).filter(inView).map(el => ({text: el.textContent, height: round(r(el).height)}));
  const callout = document.querySelector('[data-v4="callout-chip"]'), roadmap = document.querySelector('[data-motion-roadmap]');
  const calloutOverlap = !!(callout && roadmap && inView(callout) && intersects(r(callout), r(roadmap)));
  const output = {frame, pose: cameraAt(frame), scroll: round(scrollAt(frame)), hero: h ? {id: h.message.id, rise: h.rise} : null, anchorError, events, headlines, texts, chips, calloutOverlap, roadmap: roadmap?.textContent ?? '', pmActive: texts.some(t => t.text === '지휘 중'), audit: frame === 0 ? {rotation: Array.from({length: 31}, (_, i) => ({frame: 180 + i, pose: cameraAt(180 + i)})), segments: SEGMENTS} : undefined};
  console.log('V4PMMOTION ' + JSON.stringify(output));
  if (anchorError !== null && anchorError > 1) throw new Error(`프레임 ${frame} 앵커 오차 ${anchorError}`);
  if (frame >= 210 && frame < 1530 && texts.some(t => t.font < (t.role === 'body' ? 20 : 18) || t.overflow)) throw new Error(`프레임 ${frame} 글자 크기/넘침 실패`);
  if (frame >= 210 && frame < 1530 && (calloutOverlap || chips.some(c => c.height < 36))) throw new Error(`프레임 ${frame} 콜아웃 겹침/칩 크기 실패`);
};
