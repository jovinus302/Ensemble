// Live check of one PM planning call on the selected PM runtime (ENSEMBLE_PM_RUNTIME=api|codex|claude).
// Usage: ENSEMBLE_PM_RUNTIME=claude ENSEMBLE_MODEL_PM=haiku npm run smoke:pm
import { loadEnv, modelFor, pmRuntimeFromEnv } from '@ensemble/llm';
import { proposePlan } from '../src/planning.ts';

loadEnv();
const { runtime, llm } = pmRuntimeFromEnv();
const members = [
  { memberId: 'owner', kind: 'human' as const, displayName: '민지', weeklyHours: 10 },
  { memberId: 'designer', kind: 'human' as const, displayName: '서연', weeklyHours: 8 },
  { memberId: 'research-agent', kind: 'agent' as const, displayName: '조사 에이전트', role: '고객 조사와 반응 분석' },
  { memberId: 'prototype-agent', kind: 'agent' as const, displayName: '구현 에이전트', role: '웹 프로토타입 구현' },
];
const started = Date.now();
const plan = await proposePlan({ goal: '동네 필라테스 예약 웹 프로토타입', members, decider: 'owner', llm, model: modelFor('pm') });
const seconds = ((Date.now() - started) / 1000).toFixed(1);
for (const task of plan.tasks) console.log(`- ${task.title} (${task.assignee}): ${task.handoffConditions.join(' / ')}`);
console.log(`smoke:pm OK runtime=${runtime} model=${process.env.ENSEMBLE_MODEL_PM ?? '(default)'} tasks=${plan.tasks.length} duration=${seconds}s`);
