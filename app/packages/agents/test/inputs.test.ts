import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { writeInputFiles } from '../src/codex/connector.ts';
import { continueInstructions, MAX_FILE_BYTES, taskInstructions, type TaskInstructionsInput } from '../src/protocol.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function workspace() { const root = await mkdtemp(path.join(tmpdir(), 'ensemble-inputs-')); roots.push(root); return root; }
const b64 = (text: string) => Buffer.from(text).toString('base64');

it('writes handed-over files under inputs/ and leaves identical files untouched on a retry', async () => {
  const root = await workspace();
  const files = [{ path: 'inputs/흐름 설계/flow.md', data: b64('# 흐름') }];
  await writeInputFiles(root, files);
  const target = path.join(root, 'inputs', '흐름 설계', 'flow.md');
  expect(await readFile(target, 'utf8')).toBe('# 흐름');
  const before = (await stat(target)).mtimeMs;
  await new Promise(resolve => setTimeout(resolve, 20));
  await writeInputFiles(root, files);
  expect((await stat(target)).mtimeMs).toBe(before);
  await writeInputFiles(root, [{ path: 'inputs/흐름 설계/flow.md', data: b64('# 흐름 v2') }]);
  expect(await readFile(target, 'utf8')).toBe('# 흐름 v2');
});

it.each(['../outside.md', 'inputs/../outside.md', 'inputs/a/../../outside.md', 'notes/flow.md', 'inputs/C:/flow.md', 'inputs/a\\..\\..\\x.md', 'inputs/flow.md.'])('rejects the unsafe path %s', async unsafe => {
  const root = await workspace();
  await expect(writeInputFiles(root, [{ path: unsafe, data: b64('x') }])).rejects.toThrow('Unsafe input file path');
});

it('rejects oversized files and links that lead out of the workspace', async () => {
  const root = await workspace();
  await expect(writeInputFiles(root, [{ path: 'inputs/a/big.md', data: Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64') }])).rejects.toThrow('exceeds');
  const outside = await workspace();
  await mkdir(path.join(root, 'inputs'));
  await symlink(outside, path.join(root, 'inputs', 'linked'), 'junction');
  await expect(writeInputFiles(root, [{ path: 'inputs/linked/flow.md', data: b64('x') }])).rejects.toThrow('not a plain folder');
  await writeFile(path.join(root, 'inputs', 'plain'), 'file');
  await expect(writeInputFiles(root, [{ path: 'inputs/plain/flow.md', data: b64('x') }])).rejects.toThrow('not a plain folder');
});

const task: TaskInstructionsInput = { taskId: 'prototype', planVersion: 2, goalSummary: { text: '목표', sourceId: 'g' }, taskTitle: { text: '프로토타입', sourceId: 'p' },
  handoffConditions: [], decisions: [], inputs: [{ text: '결과 파일: inputs/흐름 설계/flow.md (원래 이름: flow.md, 올린 사람: 디자이너, 선행 작업: 흐름 설계)', sourceId: 'inputs/흐름 설계/flow.md' }],
  openQuestions: [], files: [{ path: 'inputs/흐름 설계/flow.md', data: b64('x') }] };

it('tells the agent to read inputs/ and keep results outside it', () => {
  const text = taskInstructions(task);
  expect(text).toContain('결과 파일: inputs/흐름 설계/flow.md (원래 이름: flow.md, 올린 사람: 디자이너');
  expect(text).toContain('작업 폴더의 inputs/ 폴더에 복사되어 있습니다');
  expect(text).toContain('결과 파일은 inputs/ 밖에 만드세요');
  expect(taskInstructions({ ...task, files: [] })).not.toContain('inputs/ 폴더에 복사');
});

it('builds a follow-up turn: acknowledgement first, then carry on; full instructions only for a thread new to the task', () => {
  const update = { updateId: 'answer:question:prototype:1', fromVersion: 2, toVersion: 2, keep: [], change: ['질문 "첫 화면?"에 대한 답: 가입'], drop: [], reason: '담당자가 질문에 답했습니다' };
  const short = continueInstructions({ taskId: 'prototype', planVersion: 2, update, task }, false);
  expect(short).toMatch(/^# 추가 전달 \(계획 버전 2\)/);
  expect(short).toContain('acknowledge_update 블록을 먼저 쓴 뒤, 작업 ID prototype 작업을 멈춘 지점부터 이어서 진행하세요.');
  expect(short).toContain('planVersion은 2입니다');
  expect(short).not.toContain('# 작업 지시');
  expect(continueInstructions({ taskId: 'prototype', planVersion: 2, update, task }, true)).toMatch(/^# 작업 지시: 프로토타입[\s\S]*# 추가 전달/);
});
