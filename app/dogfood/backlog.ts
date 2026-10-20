// BACKLOG.md·DOGFOOD_GOAL.md 파싱, 보드 기준 완료(boardDone)와 검증 기준 완료(verifiedDone).
import { project, type LedgerEvent } from '@ensemble/core';

export interface BacklogItem {
  id: string;
  epicId: string;
  epicTitle: string;
  title: string;
  area?: string;
  /** 에픽의 [iter:N]. 없으면 1. */
  iteration: number;
  /** [solo:<팀원>] 태그. 보드에 올리지 않고 그 팀원이 혼자 하는 항목. */
  solo?: string;
  /** 체크박스가 체크돼 있는지. */
  checked: boolean;
}

export const BACKLOG_ID = /\bB-\d+\b/g;

export function backlogIdsIn(text: string): string[] {
  return [...new Set(text.match(new RegExp(BACKLOG_ID.source, 'g')) ?? [])];
}

export function parseBacklog(markdown: string): BacklogItem[] {
  const items: BacklogItem[] = [];
  let epic: { id: string; title: string; iteration: number } | undefined;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^##\s+(E\d+)\s+(.*?)\s*(?:\[iter:(\d+)\])?\s*$/.exec(line);
    if (h) {
      epic = { id: h[1]!, title: h[2]!.trim(), iteration: h[3] ? Number(h[3]) : 1 };
      continue;
    }
    const m = /^\s*[-*]\s+\[([ xX])\]\s+(B-\d+)\s+(.*)$/.exec(line);
    if (!m || !epic) continue;
    let rest = m[3]!;
    let solo: string | undefined;
    const soloMatch = /\s*\[solo:([^\]\s]+)\]\s*$/.exec(rest);
    if (soloMatch) { solo = soloMatch[1]!; rest = rest.slice(0, soloMatch.index); }
    let area: string | undefined;
    const areaMatch = /\s*\(area:\s*([^)]+?)\)\s*$/.exec(rest);
    if (areaMatch) { area = areaMatch[1]!; rest = rest.slice(0, areaMatch.index); }
    items.push({
      id: m[2]!, epicId: epic.id, epicTitle: epic.title, title: rest.trim(),
      ...(area === undefined ? {} : { area }), iteration: epic.iteration,
      ...(solo === undefined ? {} : { solo }), checked: m[1] !== ' ',
    });
  }
  return items;
}

/**
 * '## Iter N' 절에서 목표 문단·테스트 명령·기한을 읽는다. 테스트 줄이 없으면 'npm test'.
 * '기한: YYYY-MM-DD'(또는 '기한은 YYYY-MM-DD…') 줄은 deadline으로 읽고 목표 본문에서 뺀다. 없으면 deadline도 없다.
 */
export function parseGoal(markdown: string, iteration: number): { goal: string; testCommand: string; deadline?: string } {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+Iter\\s+${iteration}\\s*$`).test(l.trim()));
  if (start < 0) throw new Error(`DOGFOOD_GOAL.md에 '## Iter ${iteration}' 절이 없습니다`);
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l)) break;
    body.push(l);
  }
  let testCommand = 'npm test';
  let deadline: string | undefined;
  const goal: string[] = [];
  for (const l of body) {
    const t = /^\s*테스트\s*:\s*(.+?)\s*$/.exec(l);
    const d = /^\s*기한\s*(?:은|는|:)\s*(\d{4}-\d{2}-\d{2})/.exec(l);
    if (t) testCommand = t[1]!;
    else if (d) deadline = d[1]!;
    else goal.push(l);
  }
  const text = goal.join('\n').trim();
  if (!text) throw new Error(`'## Iter ${iteration}' 절에 목표 문단이 없습니다`);
  return { goal: text, testCommand, ...(deadline === undefined ? {} : { deadline }) };
}

/** 제품 원장 기준: 취소되지 않은 checked 작업의 제목·인수 조건에 나온 B-id(인박스·리포트 보조용). */
export function boardDone(product: readonly LedgerEvent[]): Set<string> {
  const done = new Set<string>();
  for (const task of project(product).tasks.values()) {
    if (task.status !== 'checked') continue;
    for (const id of backlogIdsIn([task.spec.title, ...task.spec.handoffConditions].join('\n'))) done.add(id);
  }
  return done;
}

/** 하네스 원장 기준: main에 머지되고 테스트가 통과한 항목(정지·지표용). */
export function verifiedDone(harness: readonly LedgerEvent[]): Set<string> {
  const done = new Set<string>();
  for (const e of harness) {
    if (e.type !== 'dogfood_backlog_progress') continue;
    const p = e.payload as { itemId?: unknown; status?: unknown };
    if (p.status === 'done' && typeof p.itemId === 'string') done.add(p.itemId);
  }
  return done;
}
