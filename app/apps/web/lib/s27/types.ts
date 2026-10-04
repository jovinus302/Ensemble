/**
 * S27 marketing demo — shared contract (coordinator-owned; workers read only).
 *
 * Local scripted presentation for issue #62. Nothing here calls a model, Slack, a meeting service
 * or the Ensemble server. Story source: docs/demo/s27-brief.md.
 */

/** Where something happens. `meeting` and `slack` are simulated channels; `hub` is Ensemble itself. */
export type Surface = 'meeting' | 'slack' | 'hub';

/** Honest implementation status shown next to every capability the demo touches. */
export type Availability =
  | 'implemented' // 현재 구현: exists in the Ensemble app today (cite code)
  | 'demoable' // 데모 가능: shown by this scripted demo only, not wired to real data
  | 'planned'; // 추가 개발 필요: not built; the demo only simulates it

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  implemented: '현재 구현',
  demoable: '데모 가능',
  planned: '추가 개발 필요',
};

export interface Capability {
  id: string;
  label: string;
  availability: Availability;
  /** One sentence: what is real vs simulated. */
  note: string;
  /** Repo-relative code path(s) backing an `implemented` claim. */
  evidence?: string[];
}

export type ActorKind = 'human' | 'agent';

export interface Actor {
  id: string;
  name: string;
  role: string;
  kind: ActorKind;
  /** Short initials or glyph for avatars. */
  initials: string;
  /** Optional illustrated avatar under /s27/ (public), e.g. '/s27/avatar-harin.webp'. Agents use initials. */
  avatar?: string;
}

/** Kinds of things the hub stores and links. */
export type NodeKind = 'source' | 'decision' | 'request' | 'tool_run' | 'artifact' | 'feedback';

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  source: '공유 자료',
  decision: '결정',
  request: '요청',
  tool_run: '도구 실행',
  artifact: '결과물',
  feedback: '피드백',
};

export interface ArtifactSection {
  /** e.g. '메타 피드 A', '숏폼 스크립트' */
  label: string;
  /** Plain text; newlines allowed. */
  body: string;
  /** Node ids this section is grounded on (decisions/sources/feedback). */
  grounds: string[];
  /** Optional visual under /s27/ (public); copy is overlaid in HTML, never baked into the image. */
  image?: string;
}

export interface ContextNode {
  id: string;
  kind: NodeKind;
  title: string;
  /** Compact label for map cards and chips (<= 10 Korean chars). */
  short: string;
  summary: string;
  /** Surface where it originated (sources pre-existing in the hub use 'hub'). */
  origin: Surface;
  /** Channel or room label, e.g. '#s27-launch', '캠페인 킥오프 미팅'. */
  place: string;
  actorId: string;
  /** Display time label, e.g. '10/1 14:20'. */
  at: string;
  /** Artifacts only. */
  version?: string;
  /** Artifacts only: id of the version this one revises. */
  supersedes?: string;
  /** Artifacts only. */
  sections?: ArtifactSection[];
  /** Artifacts only: human-readable change notes vs `supersedes`. */
  changes?: string[];
}

export type EdgeRelation =
  | 'grounds' // source/decision -> decision/artifact
  | 'constrains' // decision -> artifact
  | 'requested' // request -> artifact / tool_run
  | 'used' // tool_run -> artifact
  | 'feedback_on' // feedback -> artifact
  | 'revises'; // newer artifact -> older artifact

export const EDGE_RELATION_LABEL: Record<EdgeRelation, string> = {
  grounds: '근거',
  constrains: '제약',
  requested: '요청',
  used: '사용',
  feedback_on: '피드백',
  revises: '수정본',
};

export interface ContextEdge {
  from: string;
  to: string;
  relation: EdgeRelation;
}

export type LineKind =
  | 'message' // ordinary human or agent chat line
  | 'capture' // Ensemble agent noting what it stored in the hub
  | 'artifact'; // Ensemble agent posting an artifact card

export interface ChatLine {
  id: string;
  surface: Exclude<Surface, 'hub'>;
  /** e.g. '#s27-launch', '#brand-review', '캠페인 킥오프 미팅' */
  place: string;
  actorId: string;
  at: string;
  text: string;
  kind: LineKind;
  /** Hub node ids this line cites or creates; UI renders them as chips that open the node. */
  refs?: string[];
}

export type StageNo = 1 | 2 | 3 | 4 | 5;

/** One presenter click. Reveals are cumulative across beats. */
export interface Beat {
  id: string;
  stage: StageNo;
  /** Short stage title shown in the stepper. */
  title: string;
  /** The one big on-screen message for this beat (<= 15 Korean chars). */
  headline: string;
  /** What the presenter says/points at for this beat (1–2 sentences). */
  caption: string;
  /** Surface the UI should bring forward. */
  focus: Surface;
  /** Chat line ids revealed at this beat. */
  lines: string[];
  /** Hub node ids revealed at this beat. Edges show once both endpoints are revealed. */
  nodes: string[];
  /** Node to auto-select in the hub inspector, if any. */
  highlight?: string;
  /** Capability ids this beat demonstrates. */
  capabilities: string[];
}

export const STAGE_TITLE: Record<StageNo, string> = {
  1: '미팅에서 결정',
  2: '슬랙에서 요청',
  3: '맥락으로 드래프트',
  4: '근거·결정 연결 확인',
  5: '다른 팀원이 이어서 수정',
};

/** Hypothesis comparison for the 경험적 해자 slide. Values are scenario assumptions, not measurements. */
export interface MoatMetric {
  id: string;
  label: string;
  legacy: string;
  ensemble: string;
  /** How it would actually be verified (from issue #62). */
  verification: string;
}

export interface S27Scenario {
  team: { name: string; goal: string };
  actors: Actor[];
  nodes: ContextNode[];
  edges: ContextEdge[];
  lines: ChatLine[];
  beats: Beat[];
  capabilities: Capability[];
  metrics: MoatMetric[];
}

// ---- engine contract (implemented in ./engine.ts) ----

export interface S27State {
  /** Index into scenario.beats; -1 = title screen before the first beat. */
  beat: number;
  /** Surface the viewer chose; null follows the current beat's focus. */
  surface: Surface | null;
  /** Hub inspector selection; null follows the current beat's highlight. */
  selectedNodeId: string | null;
  /** Artifact version being viewed in the hub; null = latest revealed. */
  artifactVersionId: string | null;
}

export type S27Action =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'reset' }
  | { type: 'goto'; beat: number }
  | { type: 'show_surface'; surface: Surface | null }
  | { type: 'select_node'; id: string | null }
  | { type: 'view_artifact'; id: string | null };

export interface Trace {
  node: ContextNode;
  /** Transitive upstream (what it is grounded on), nearest first, revealed nodes only. */
  upstream: { node: ContextNode; relation: EdgeRelation; depth: number }[];
  /** Direct downstream (what depends on it), revealed nodes only. */
  downstream: { node: ContextNode; relation: EdgeRelation }[];
}

export interface S27View {
  index: number; // == state.beat
  total: number;
  beat: Beat | null; // null on title screen
  stage: StageNo | null;
  surface: Surface; // resolved (state.surface ?? beat.focus ?? 'meeting')
  /** Revealed chat lines in scenario order, grouped by surface. */
  meeting: ChatLine[];
  slack: ChatLine[];
  /** Lines revealed at exactly this beat (for highlight animation). */
  freshLineIds: string[];
  nodes: ContextNode[]; // revealed, scenario order
  edges: ContextEdge[]; // both endpoints revealed
  freshNodeIds: string[];
  selected: Trace | null; // resolved (state.selectedNodeId ?? beat.highlight)
  /** Revealed artifact versions, oldest first, and the one being viewed. */
  artifactVersions: ContextNode[];
  artifact: ContextNode | null;
  capabilities: Capability[]; // for the current beat
  canPrev: boolean;
  canNext: boolean;
}
