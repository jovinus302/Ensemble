'use client';

import { createContext, useContext, useEffect, useState, type Dispatch } from 'react';
import { S27, NODE_KIND_LABEL, type Actor, type ContextNode, type S27Action } from '../../lib/s27';

export const actorById = new Map<string, Actor>(S27.actors.map((a) => [a.id, a]));
export const nodeById = new Map<string, ContextNode>(S27.nodes.map((n) => [n.id, n]));
export const capabilityById = new Map(S27.capabilities.map((c) => [c.id, c]));

const HUMAN_VOICES = ['3', '2', '6', '4', '5', '7', '8'];

/** Stable voice token per actor: the Ensemble agent uses the PM voice, other agents voice-1, people cycle the rest. */
export function voiceOf(actorId: string): string {
  const actor = actorById.get(actorId);
  if (!actor) return '8';
  if (actor.kind === 'agent') return actor.id === 'ensemble' ? 'pm' : '1';
  const humans = S27.actors.filter((a) => a.kind === 'human');
  return HUMAN_VOICES[humans.indexOf(actor) % HUMAN_VOICES.length] ?? '8';
}

/** Node title with its version appended unless the title already carries it. */
export function nodeTitle(node: ContextNode): string {
  return node.version && !node.title.includes(node.version) ? `${node.title} ${node.version}` : node.title;
}

export function Avatar({ actorId, size = 'md' }: { actorId: string; size?: 'sm' | 'md' | 'lg' }) {
  const actor = actorById.get(actorId);
  return (
    <span className={`s27-avatar s27-avatar-${size} s27-voice-${voiceOf(actorId)}${actor?.kind === 'agent' ? ' is-agent' : ''}`} aria-hidden="true">
      {actor?.initials ?? '?'}
    </span>
  );
}

export interface S27Ctx {
  dispatch: Dispatch<S27Action>;
  wide: boolean;
  /** Select a hub node; on narrow screens also bring the hub tab forward. */
  openNode: (id: string) => void;
}

export const S27Context = createContext<S27Ctx | null>(null);

export function useS27(): S27Ctx {
  const ctx = useContext(S27Context);
  if (!ctx) throw new Error('S27Context missing');
  return ctx;
}

export function useMediaQuery(query: string, fallback: boolean): boolean {
  const [matches, setMatches] = useState(fallback);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function NodeChip({ id, active }: { id: string; active?: boolean }) {
  const { openNode } = useS27();
  const node = nodeById.get(id);
  if (!node) return null;
  return (
    <button type="button" className={`s27-chip s27-kind-${node.kind}${active ? ' is-active' : ''}`} onClick={() => openNode(id)} title={node.summary}>
      <span className="s27-chip-kind">{NODE_KIND_LABEL[node.kind]}</span>
      <span className="s27-chip-title">{nodeTitle(node)}</span>
    </button>
  );
}
