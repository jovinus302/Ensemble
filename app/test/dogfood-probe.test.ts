import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import type { LedgerEvent } from '@ensemble/core';
import { appDir } from '../dogfood/config.ts';
import { buildProbeQuestions, ruleReader, scoreProbe, spaceStatus, type ProbeQuestion } from '../dogfood/probe.ts';

let seq = 0;
function ev(type: string, payload: unknown, actorId = 'system'): LedgerEvent {
  seq += 1;
  return { id: `e${seq}`, seq, type, projectId: 'p', targetProductId: 'ensemble', actor: { kind: 'system', id: actorId }, at: new Date(1_700_000_000_000 + seq * 1000).toISOString(), payload };
}

const spec = (id: string, title: string, assignee: string) => ({ id, title, assignee, dependsOn: [], handoffConditions: [], exclusions: [], limits: [] });
const link = (id: string, displayName: string) => ev('participant_linked', {
  participantId: id, displayName, tool: 'claude', workspaceRoot: '/w', allowedPaths: ['.'], scopes: {}, linkedBy: 'owner',
});
const post = (n: number, participantId: string, kind: string, text: string) => ev('space_post_recorded', {
  postId: `post-${n}`, participantId, kind, text, clientPostId: `c${n}`, source: { tool: 'claude', workspaceRoot: '/w', via: 'space_http' }, observedAt: new Date().toISOString(),
});

function fixture(): LedgerEvent[] {
  seq = 0;
  return [
    ev('member_joined', { memberId: 'owner', kind: 'human', displayName: '오너 김' }),
    ev('member_joined', { memberId: 'designer', kind: 'human', displayName: '디자이너 이' }),
    ev('member_joined', { memberId: 'research-agent', kind: 'agent', displayName: '리서치 에이전트' }),
    ev('plan_committed', {
      version: 1, basedOn: null, reason: 't', approvedBy: 'owner', sourceMessageIds: [],
      tasks: [spec('t1', '인터뷰 정리', 'owner'), spec('t2', '흐름 초안', 'designer'), spec('t3', '조사', 'research-agent'), spec('t4', '검토', 'owner')],
    }),
    link('mate-a', '팀원 에이'),
    link('mate-b', '팀원 비'),
    post(1, 'mate-a', 'note', 'B-01 시작'),
    post(2, 'mate-a', 'result', 'B-01 완료'),
    post(3, 'mate-a', 'note', '다음 B-02 확인'),
    post(4, 'mate-b', 'result', 'B-03 완료'),
    post(5, 'mate-b', 'blocked', 'B-04 막힘'),
  ];
}

test('spaceStatus: 없음 unknown, 마지막 blocked, result 뒤 blocked 없으면 done, 그 밖 in_progress', () => {
  assert.equal(spaceStatus([]), 'unknown');
  assert.equal(spaceStatus([{ kind: 'note' }, { kind: 'blocked' }]), 'blocked');
  assert.equal(spaceStatus([{ kind: 'blocked' }, { kind: 'result' }]), 'done');
  assert.equal(spaceStatus([{ kind: 'result' }, { kind: 'note' }]), 'done');
  assert.equal(spaceStatus([{ kind: 'result' }, { kind: 'blocked' }, { kind: 'note' }]), 'in_progress');
  assert.equal(spaceStatus([{ kind: 'note' }, { kind: 'question' }]), 'in_progress');
});

test('buildProbeQuestions: 작업 3개 회전과 참여자별 팀원 질문, 기대값은 관찰 규칙으로 만든다', () => {
  const events = fixture();
  const q0 = buildProbeQuestions(events, [], 0);
  assert.equal(q0.length, 5);
  const tasks = q0.filter((q) => q.kind === 'task');
  assert.deepEqual(tasks.map((q) => q.kind === 'task' && q.title), ['인터뷰 정리', '흐름 초안', '조사']);
  assert.deepEqual(tasks.map((q) => q.expected), [
    { who: '오너 김', status: 'todo' },
    { who: '디자이너 이', status: 'todo' },
    { who: '리서치 에이전트', status: 'todo' },
  ]);
  const mates = q0.filter((q) => q.kind === 'mate');
  assert.deepEqual(mates.map((q) => q.expected), [
    { who: '팀원 에이', items: ['B-01', 'B-02'], status: 'done' },
    { who: '팀원 비', items: ['B-03', 'B-04'], status: 'blocked' },
  ]);
  const q1 = buildProbeQuestions(events, [], 1);
  assert.deepEqual(q1.filter((q) => q.kind === 'task').map((q) => q.kind === 'task' && q.title), ['검토', '인터뷰 정리', '흐름 초안']);
  assert.equal(buildProbeQuestions(events, [], 0, 4).length, 4);
});

test('scoreProbe: 이름 포함·공백 무시, 상태 일치, mate는 items, unknown은 오답', () => {
  const questions = buildProbeQuestions(fixture(), [], 0);
  const answers = [
    { id: 'task-1', who: '오너김', status: 'todo' },
    { id: 'task-2', who: '디자이너', status: 'todo' },
    { id: 'task-3', who: '리서치 에이전트', status: 'unknown' },
    { id: 'mate-4', who: '팀원 에이', status: 'done', what: '작업 B-02 진행' },
    { id: 'mate-5', who: '팀원 비', status: 'blocked', what: '막힘' },
  ];
  const score = scoreProbe(questions, answers);
  assert.equal(score.total, 5);
  assert.equal(score.correct, 3);
  assert.deepEqual(score.perQuestion.map((p) => p.correct), [true, true, false, true, false]);
  assert.equal(scoreProbe(questions, []).correct, 0);
});

test('ruleReader: 가짜 서버의 상태 JSON에서 같은 규칙으로 답해 만점이다', async () => {
  const events = fixture();
  const questions = buildProbeQuestions(events, [], 0);
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/api/state')) {
      res.end(JSON.stringify({
        members: [{ id: 'owner', displayName: '오너 김' }, { id: 'designer', displayName: '디자이너 이' }, { id: 'research-agent', displayName: '리서치 에이전트' }],
        work: { items: [
          { ownerId: 'owner', status: 'todo', title: '인터뷰 정리' },
          { ownerId: 'designer', status: 'todo', title: '흐름 초안' },
          { ownerId: 'research-agent', status: 'todo', title: '조사' },
        ] },
      }));
    } else if (req.url === '/api/space') {
      res.end(JSON.stringify({
        participants: [{ id: 'mate-a', displayName: '팀원 에이' }, { id: 'mate-b', displayName: '팀원 비' }],
        posts: [
          { participantId: 'mate-a', kind: 'note', text: 'B-01 시작' },
          { participantId: 'mate-a', kind: 'result', text: 'B-01 완료' },
          { participantId: 'mate-a', kind: 'note', text: '다음 B-02 확인' },
          { participantId: 'mate-b', kind: 'result', text: 'B-03 완료' },
          { participantId: 'mate-b', kind: 'blocked', text: 'B-04 막힘' },
        ],
      }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const answers = await ruleReader(`http://127.0.0.1:${port}`, questions);
    const score = scoreProbe(questions, answers);
    assert.equal(score.correct, score.total);
    assert.equal(score.total, 5);
    const missing = await ruleReader(`http://127.0.0.1:${port}`, [{ id: 'x', kind: 'task', text: '', title: '없는 작업', expected: { who: 'a', status: 'todo' } } as ProbeQuestion]);
    assert.equal(missing[0]!.status, 'unknown');
  } finally {
    server.close();
  }
});

test('status-probe.md는 3000자 이하이고 핵심 규칙을 담는다', () => {
  const text = readFileSync(join(appDir(), 'dogfood', 'roles', 'status-probe.md'), 'utf8');
  assert.ok(text.length <= 3000, `${text.length}자`);
  for (const word of ['curl -s', 'displayName', '팀원 상태 규칙', 'unknown', '추측 금지']) assert.ok(text.includes(word), word);
});
