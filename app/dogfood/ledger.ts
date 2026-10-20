// 하네스 원장. 제품 원장과 별개의 SQLite 파일(runDir/dogfood.db)에 하네스가 한 일을 남긴다.
// 제품 원장에는 쓰지 않는다. 귀속의 정본은 이 원장이다.
import type { LedgerEvent } from '@ensemble/core';
import { SqliteLedgerStore } from '@ensemble/store';
import type { DogfoodConfig, DogfoodMode } from './config.ts';

export type FrictionCategory =
  | 'duplicate'
  | 'status_lookup'
  | 'intervention'
  | 'blocked'
  | 'handoff'
  | 'integration'
  | 'tooling'
  | 'other';

export type InterventionType = 'rubber_stamp' | 'override' | 'answer' | 'recover' | 'initiate' | 'defer';

export type UsageSource = 'pm' | 'ensemble-agent' | 'harness';

export interface UsageRecord {
  /** 캐시 읽기·생성 토큰을 포함한 입력 토큰. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}

/**
 * 가중 토큰. pm 출처는 캐시를 모르므로 입력 전체를 쓴다.
 * 그 밖에는 캐시 없는 입력 + 출력 + 0.1x캐시 읽기 + 1.25x캐시 생성.
 */
export function weightedTokens(u: UsageRecord, source: UsageSource): number {
  if (source === 'pm') return u.inputTokens + u.outputTokens;
  const read = u.cacheReadTokens ?? 0;
  const creation = u.cacheCreationTokens ?? 0;
  return u.inputTokens - read - creation + u.outputTokens + 0.1 * read + 1.25 * creation;
}

/** 아직 필드를 고정하지 않은 페이로드(후속 태스크가 좁힌다). */
type Loose = Record<string, unknown>;

export interface DogfoodPayloads {
  dogfood_run_started: {
    runId: string;
    iteration: 1 | 2 | 3;
    mode: DogfoodMode;
    target: { source: string; head: string; continueFrom?: string };
    config: DogfoodConfig;
    promptHashes: Record<string, string>;
    backlogIds: string[];
    plantedSolo: string[];
    ensembleCommit: string;
    productDirty: boolean;
    adapters: { pathPrepend: boolean; pmSchemaRef: boolean };
    claude?: Loose;
    node: string;
  };
  dogfood_iteration_project: { iteration: 1 | 2 | 3; projectId: string; goal: string; deadline?: string; planAttempts: number };
  dogfood_cycle_started: { cycle: number };
  dogfood_cycle_finished: { cycle: number; productSeq: number; progressSignature: string; actions: unknown };
  dogfood_setup_step: Loose;
  dogfood_proxy_action: {
    role: 'decision-proxy' | 'harness';
    memberId: string;
    cycle: number;
    action: unknown;
    interventionType: InterventionType;
    counted: boolean;
    ok: boolean;
    error?: string;
    messageId?: string;
    via: 'live' | 'rule' | 'rule-fallback';
    harnessNoise: boolean;
  };
  dogfood_role_note: {
    role: string;
    memberId?: string;
    cycle: number;
    kind: 'dissent' | 'info';
    text: string;
    gapHint?: string;
  };
  dogfood_human_task_submitted: {
    memberId: string;
    actor: string;
    taskId: string;
    cycle: number;
    fileNames: string[];
    via: 'http' | 'fallback' | 'misrouted' | 'pending';
    httpMessageId: string | null;
    resultId: string | null;
    recognized: boolean;
    firstSubmission: boolean;
    misroutedTo?: string;
  };
  dogfood_teammate_session: {
    jobs: { kind: 'assigned' | 'owner_code' | 'integrate' | 'solo'; ref: string }[];
    readyToMerge: boolean;
  } & Loose;
  dogfood_manual_integration: {
    by: string;
    branch: string;
    into: 'main';
    commit: string;
    files: string[];
    cycle: number;
    backlogItems: string[];
    taskIds: string[];
    conflicts?: string[];
  };
  dogfood_integration_test: Loose;
  dogfood_backlog_progress: { itemId: string; status: 'done'; by: string; evidence: string };
  dogfood_usage_recorded: Loose;
  dogfood_overlap_candidate: { key: string; backlogId: string; kind: 'overlap' | 'self_rework'; units: unknown[]; cycle: number };
  dogfood_friction_recorded: Loose;
  dogfood_gap_proposed: Loose;
  dogfood_status_probe: Loose;
  dogfood_infra_pause: { from: string; until: string; reason: string; source: string };
  dogfood_run_stopped: {
    reason: 'max_cycles' | 'max_hours' | 'budget' | 'stalled' | 'done' | 'interrupted' | 'error' | 'infra' | 'argv_limit';
    cycle: number;
    detail?: string;
  };
}

export type DogfoodEventType = keyof DogfoodPayloads;

export interface RecordOptions {
  /** 멱등성 키. 같은 키는 한 번만 기록된다. */
  key?: string;
  actor?: string;
  at?: string;
}

export class DogfoodLedger {
  private readonly store: SqliteLedgerStore;
  private readonly runId: string;

  constructor(file: string, runId: string) {
    this.store = new SqliteLedgerStore(file);
    this.runId = runId;
  }

  async record<T extends DogfoodEventType>(type: T, payload: DogfoodPayloads[T], opts: RecordOptions = {}): Promise<LedgerEvent> {
    const [event] = await this.store.append([
      {
        type,
        projectId: this.runId,
        targetProductId: 'dogfood',
        actor: opts.actor === undefined ? { kind: 'system', id: 'dogfood-harness' } : { kind: 'system', id: opts.actor },
        ...(opts.at === undefined ? {} : { at: opts.at }),
        ...(opts.key === undefined ? {} : { idempotencyKey: opts.key }),
        payload,
      },
    ]);
    return event!;
  }

  read(): Promise<LedgerEvent[]> {
    return this.store.read({ projectId: this.runId });
  }

  close(): void {
    this.store.close();
  }
}
