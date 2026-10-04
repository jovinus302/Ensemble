'use client';

import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { S27, NODE_KIND_LABEL, type Actor, type ArtifactSection, type ContextNode, type NodeKind, type S27Action } from '../../lib/s27';

export const actorById = new Map<string, Actor>(S27.actors.map((a) => [a.id, a]));
export const nodeById = new Map<string, ContextNode>(S27.nodes.map((n) => [n.id, n]));
export const capabilityById = new Map(S27.capabilities.map((c) => [c.id, c]));

export const KIND_ORDER: NodeKind[] = ['source', 'decision', 'request', 'tool_run', 'artifact', 'feedback'];
/** One-word kind labels for counts and chain groups. */
export const KIND_SHORT: Record<NodeKind, string> = {
  source: '자료', decision: '결정', request: '요청', tool_run: '도구', artifact: '결과물', feedback: '피드백',
};

const HUMAN_VOICES = ['3', '2', '6', '4', '5', '7', '8'];

/** Stable voice token per actor: the Ensemble agent uses the PM voice, other agents voice-1, people cycle the rest. */
export function voiceOf(actorId: string): string {
  const actor = actorById.get(actorId);
  if (!actor) return '8';
  if (actor.kind === 'agent') return actor.id === 'ensemble' ? 'pm' : '1';
  const humans = S27.actors.filter((a) => a.kind === 'human');
  return HUMAN_VOICES[humans.indexOf(actor) % HUMAN_VOICES.length] ?? '8';
}

/** Compact node label; falls back to the title until every node carries `short`. */
export function nodeShort(node: ContextNode): string {
  const short = node.short || node.title;
  return node.version && !short.includes(node.version) ? `${short} ${node.version}` : short;
}

/**
 * Plain <img> that swaps to `fallback` when the source is missing or fails to load,
 * including a failure that happened before hydration attached onError.
 */
export function Img({ src, alt, width, height, className, fallback }: {
  src?: string; alt: string; width: number; height: number; className?: string; fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    setFailed(Boolean(el && el.complete && el.naturalWidth === 0));
  }, [src]);
  if (!src || failed) return <>{fallback}</>;
  return <img ref={ref} src={src} alt={alt} width={width} height={height} className={className} decoding="async" onError={() => setFailed(true)} />;
}

/** Neutral gradient stand-in for a missing visual. */
export function ImgFallback({ label, className }: { label: string; className?: string }) {
  return <span className={`s27-img-fallback${className ? ` ${className}` : ''}`} role="img" aria-label={label} />;
}

const AVATAR_PX = { sm: 24, md: 32, lg: 56, xl: 88 } as const;

export function Avatar({ actorId, size = 'md', label }: { actorId: string; size?: keyof typeof AVATAR_PX; label?: boolean }) {
  const actor = actorById.get(actorId);
  const px = AVATAR_PX[size];
  const alt = label && actor ? `${actor.name} 프로필 이미지` : '';
  const initials = (
    <span className="s27-avatar-initials" role={label ? 'img' : undefined} aria-label={label ? alt : undefined}>
      {actor?.initials ?? '?'}
    </span>
  );
  return (
    <span
      className={`s27-avatar s27-avatar-${size} s27-voice-${voiceOf(actorId)}${actor?.kind === 'agent' ? ' is-agent' : ''}`}
      aria-hidden={label ? undefined : true}
    >
      <Img src={actor?.avatar} alt={alt} width={px} height={px} fallback={initials} />
    </span>
  );
}

export interface S27Ctx {
  dispatch: Dispatch<S27Action>;
  /** Select a hub node and bring the hub forward. */
  openNode: (id: string) => void;
}

export const S27Context = createContext<S27Ctx | null>(null);

export function useS27(): S27Ctx {
  const ctx = useContext(S27Context);
  if (!ctx) throw new Error('S27Context missing');
  return ctx;
}

export function NodeChip({ id }: { id: string }) {
  const { openNode } = useS27();
  const node = nodeById.get(id);
  if (!node) return null;
  return (
    <button
      type="button"
      className={`s27-chip s27-kind-${node.kind}`}
      onClick={() => openNode(id)}
      title={node.title}
      aria-label={`${NODE_KIND_LABEL[node.kind]}: ${node.title} — 허브에서 열기`}
    >
      <span className="s27-chip-dot" aria-hidden="true" />
      {nodeShort(node)}
    </button>
  );
}

/** At most `max` chips; the rest collapse into a "+N" toggle. */
export function RefChips({ refs, max = 3, label = '연결된 앙상블 항목' }: { refs: string[]; max?: number; label?: string }) {
  const [open, setOpen] = useState(false);
  const ids = refs.filter((id) => nodeById.has(id));
  if (ids.length === 0) return null;
  const shown = open ? ids : ids.slice(0, max);
  const rest = ids.length - max;
  return (
    <div className="s27-chips" role="group" aria-label={label}>
      {shown.map((id) => <NodeChip key={id} id={id} />)}
      {rest > 0 && (
        <button type="button" className="s27-chip s27-chip-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '접기' : `+${rest}`}
          <span className="s27-sr">{open ? ' 연결 항목 접기' : ' 연결 항목 더 보기'}</span>
        </button>
      )}
    </div>
  );
}

// ---- artifact copy parsing (section bodies are plain text) ----

export interface AdCopy { headline: string; body: string; footnotes: string[] }

const PREFIX = (word: string) => new RegExp(`^${word}\\s*[:：]\\s*`);

export function parseAdCopy(text: string): AdCopy {
  let headline = '';
  const body: string[] = [];
  const footnotes: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('*') || line.startsWith('※')) footnotes.push(line);
    else if (PREFIX('헤드라인').test(line)) headline = line.replace(PREFIX('헤드라인'), '');
    else if (PREFIX('본문').test(line)) body.push(line.replace(PREFIX('본문'), ''));
    else if (!headline) headline = line;
    else body.push(line);
  }
  return { headline, body: body.join(' '), footnotes };
}

/** Opening beat of a short-form script: the first line's scene and on-screen subtitle. */
export function parseShortOpening(text: string): { scene: string; subtitle: string } {
  const first = text.split('\n').find((l) => l.trim()) ?? '';
  const noTime = first.replace(/^\s*[\d–\-~ ]+초\s*[:：]\s*/, '');
  const m = noTime.match(/자막\s*[:：]\s*(.+)$/);
  const subtitle = m ? m[1]!.trim() : '';
  const scene = (m ? noTime.slice(0, m.index) : noTime).replace(/[.\s]+$/, '').trim();
  return { scene, subtitle };
}

export function isShortSection(section: ArtifactSection): boolean {
  return /숏폼|short/i.test(section.label);
}
