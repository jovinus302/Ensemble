// Figma share links → file key and node id (issue #78). Only figma.com links are accepted; a branch link
// points at the branch file, because the REST API addresses a branch by its own key.
export type FigmaLinkKind = 'design' | 'file' | 'proto' | 'board';
export interface FigmaLink { kind: FigmaLinkKind; fileKey: string; /** API form, e.g. "1:2". */ nodeId?: string; url: string }

const KINDS: readonly string[] = ['design', 'file', 'proto', 'board'];
const KEY = /^[A-Za-z0-9]{10,64}$/;
const NODE = /^I?\d+:\d+(;\d+:\d+)*$/;

/** URL node ids use "-" ("1-2"); older links encode ":" ("1%3A2"). Both become "1:2". */
export function nodeIdFromUrl(raw: string): string | null {
  let value: string;
  try { value = decodeURIComponent(raw); } catch { return null; }
  const id = value.includes(':') ? value : value.replaceAll('-', ':');
  return NODE.test(id) ? id : null;
}

export function parseFigmaLink(input: string): FigmaLink | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || (url.hostname !== 'figma.com' && url.hostname !== 'www.figma.com')) return null;
  const [kind, key, third, branchKey] = url.pathname.split('/').filter(Boolean);
  if (!kind || !KINDS.includes(kind) || !key || !KEY.test(key)) return null;
  const fileKey = third === 'branch' && branchKey && KEY.test(branchKey) ? branchKey : key;
  const rawNode = url.searchParams.get('node-id');
  const nodeId = rawNode ? nodeIdFromUrl(rawNode) : undefined;
  if (nodeId === null) return null;
  return { kind: kind as FigmaLinkKind, fileKey, ...(nodeId ? { nodeId } : {}), url: url.toString() };
}
