// 실행 Agent 토큰 수집. 제품은 Claude 커넥터의 usage를 버리므로(G15) 하네스가 Claude Code 트랜스크립트
// (~/.claude/projects/<sanitize(workspace)>/*.jsonl)를 읽기만 해서 dogfood_usage_recorded로 옮긴다.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { DogfoodLedger } from './ledger.ts';

/** Claude Code가 작업 폴더 경로를 프로젝트 폴더 이름으로 바꾸는 규칙: 영숫자가 아닌 문자는 모두 '-'. */
export function sanitize(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-');
}

/** 기본 트랜스크립트 루트(~/.claude/projects). */
export function defaultProjectsRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

function subdirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * 작업 폴더 하나의 트랜스크립트 폴더. 이름이 정확히 같은 것을 먼저, 없으면 대소문자만 다른 것
 * (Windows 드라이브 글자), 그래도 없으면 긴 경로의 잘린 이름(앞 200자가 같은 것)을 찾는다.
 */
export function findTranscriptDir(projectsRoot: string, workspace: string): string | undefined {
  const want = sanitize(workspace);
  const names = subdirs(projectsRoot);
  const hit =
    names.find((n) => n === want) ??
    names.find((n) => n.toLowerCase() === want.toLowerCase()) ??
    (want.length > 200 ? names.find((n) => n.startsWith(want.slice(0, 200))) : undefined);
  return hit === undefined ? undefined : join(projectsRoot, hit);
}

/** agentsRoot 아래(자기 자신 포함)의 모든 작업 폴더에 해당하는 트랜스크립트 폴더. 정확히 같은 것이 앞에 온다. */
export function findTranscriptDirs(projectsRoot: string, agentsRoot: string): string[] {
  const base = sanitize(agentsRoot).toLowerCase();
  const names = subdirs(projectsRoot).filter((n) => {
    const l = n.toLowerCase();
    return l === base || l.startsWith(`${base}-`);
  });
  names.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return names.map((n) => join(projectsRoot, n));
}

export interface TranscriptUsage {
  /** message.id:requestId. 스트리밍으로 같은 응답이 여러 줄 남으므로 이 키로 한 건만 센다. */
  key: string;
  at: string;
  sessionId: string;
  model: string;
  /** 캐시 읽기·생성 토큰을 포함한 입력 토큰(하네스 UsageRecord와 같은 규칙). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** JSONL 한 파일을 읽어 어시스턴트 응답별 사용량을 모은다. 같은 키는 마지막 줄 값을 쓴다. 깨진 줄은 건너뛴다. */
export function parseTranscript(text: string): TranscriptUsage[] {
  const byKey = new Map<string, TranscriptUsage>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (row.type !== 'assistant') continue;
    const message = row.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (!message || !usage) continue;
    const model = typeof message.model === 'string' ? message.model : '';
    if (model === '<synthetic>') continue;
    const id = typeof message.id === 'string' ? message.id : '';
    const requestId = typeof row.requestId === 'string' ? row.requestId : '';
    const uuid = typeof row.uuid === 'string' ? row.uuid : '';
    const key = id || requestId ? `${id}:${requestId}` : uuid;
    if (!key) continue;
    const read = num(usage.cache_read_input_tokens);
    const creation = num(usage.cache_creation_input_tokens);
    byKey.set(key, {
      key,
      at: typeof row.timestamp === 'string' ? row.timestamp : new Date(0).toISOString(),
      sessionId: typeof row.sessionId === 'string' ? row.sessionId : '',
      model,
      inputTokens: num(usage.input_tokens) + read + creation,
      outputTokens: num(usage.output_tokens),
      cacheReadTokens: read,
      cacheCreationTokens: creation,
    });
  }
  return [...byKey.values()];
}

/** 여러 파일의 사용량을 키로 합친다(세션 이어받기로 같은 응답이 다른 파일에 복사될 수 있다). */
export function dedupeUsage(lists: readonly (readonly TranscriptUsage[])[]): TranscriptUsage[] {
  const byKey = new Map<string, TranscriptUsage>();
  for (const list of lists) for (const u of list) if (!byKey.has(u.key)) byKey.set(u.key, u);
  return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));
}

export interface CollectInput {
  ledger: DogfoodLedger;
  /** 실행 Agent 작업 폴더의 루트(layout.agents). 아래에 <projectId>/<agentId>가 있다. */
  agentsRoot: string;
  cycle: number;
  projectsRoot?: string;
  /** 이 시각(ISO) 이전 응답은 무시한다(하네스 시작 전 기록). */
  since?: string;
  /** 트랜스크립트 폴더 이름에서 agentId를 알아볼 때 쓰는 후보. 기본은 제품 역할 둘. */
  agentIds?: string[];
}

export interface CollectResult {
  /** 이번에 새로 기록한 건수. */
  recorded: number;
  /** 트랜스크립트에서 찾은 전체 건수. */
  found: number;
  dirs: string[];
}

/**
 * 트랜스크립트 사용량을 하네스 원장에 옮긴다. 응답 키가 멱등성 키라서 사이클마다 불러도 한 번만 기록된다.
 * agentId는 트랜스크립트 폴더 이름의 끝으로 알아본다(못 알아보면 null). 읽기만 하고 파일은 고치지 않는다.
 */
export async function collectAgentUsage(input: CollectInput): Promise<CollectResult> {
  const projectsRoot = input.projectsRoot ?? defaultProjectsRoot();
  const dirs = findTranscriptDirs(projectsRoot, input.agentsRoot);
  const base = sanitize(input.agentsRoot);
  const agentIds = input.agentIds ?? ['research-agent', 'prototype-agent'];
  const perFile: { agentId: string | null; list: TranscriptUsage[] }[] = [];
  for (const dir of dirs) {
    const name = basename(dir);
    const rest = name.length > base.length ? name.slice(base.length + 1) : '';
    // 폴더 이름은 경로 구분자를 잃었으므로 <projectId>-<agentId>의 끝이 아는 agentId와 맞는 것을 쓴다. 없으면 null.
    const agentId = agentIds.find((id) => sanitize(rest).toLowerCase().endsWith(sanitize(id).toLowerCase())) ?? null;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const file = join(dir, f);
      try {
        if (!existsSync(file) || !statSync(file).isFile()) continue;
        perFile.push({ agentId, list: parseTranscript(readFileSync(file, 'utf8')) });
      } catch {
        continue;
      }
    }
  }
  const owner = new Map<string, string | null>();
  for (const { agentId, list } of perFile) for (const u of list) if (!owner.has(u.key)) owner.set(u.key, agentId);
  const all = dedupeUsage(perFile.map((p) => p.list)).filter((u) => input.since === undefined || u.at >= input.since);
  let recorded = 0;
  const existing = new Set((await input.ledger.read()).map((e) => e.idempotencyKey).filter((k): k is string => k !== undefined));
  for (const u of all) {
    const key = `usage:agent:${u.key}`;
    if (existing.has(key)) continue;
    await input.ledger.record(
      'dogfood_usage_recorded',
      {
        source: 'ensemble-agent',
        role: 'ensemble-agent',
        agentId: owner.get(u.key) ?? null,
        cycle: input.cycle,
        ok: true,
        model: u.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheCreationTokens: u.cacheCreationTokens,
        costUsd: null,
        durationMs: null,
        sessionId: u.sessionId,
      },
      { key, at: u.at },
    );
    recorded += 1;
  }
  return { recorded, found: all.length, dirs };
}
