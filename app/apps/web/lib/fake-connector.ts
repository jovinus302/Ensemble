import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ContinueTaskInput, Report, SessionConnector, SessionEvent, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import type { RevisionGenerator } from '@ensemble/scenarios';

const research = `# 조사 보고서
시연용 가상 자료입니다. 실제 웹 조사나 고객 검증을 수행한 결과가 아닙니다.

## 대상과 비교
한국의 2~5명 제품팀이 고객 인터뷰 시간을 조율하는 상황을 가정합니다.
| 대안 | 공개 자료 출처 | 예약 방식 | 소규모 제품팀 관점의 가상 평가 |
|---|---|---|---|
| Calendly | https://calendly.com/ | 링크로 가능 시간 선택 | 링크 공유가 간단하나 고객 모집과 인터뷰 맥락은 별도 관리 |
| Cal.com | https://cal.com/ | 예약 링크와 일정 연결 | 구성 자유도가 있으나 초기 설정이 필요 |
| Google Calendar 예약 일정 | https://support.google.com/calendar/answer/10729749 | 캘린더 예약 페이지 | 기존 캘린더 사용자는 편리하나 인터뷰 근거 관리가 별도 |

## 관찰과 가설
가상 팀 A는 매주 2회 인터뷰를 하며 시간 조율에 회당 15분을 쓴다고 가정합니다.
가상 팀 B는 격주 3회, 팀 C는 월 4회 인터뷰하며 일정 재조율이 가장 큰 문제라고 가정합니다.
예약 링크, 예약 확인, 변경 안내가 핵심 흐름입니다. 가입 오류는 입력을 보존하고 재입력하게 합니다.
가입→시간 선택→예약 확인을 우선 검증하고, 가격과 결제는 가설로 분리합니다.
실제 개인정보 수집, 실제 결제, 외부 서비스 연결, 공개 배포는 하지 않습니다.

## 확인 한계와 다음 행동
위 URL은 출처 후보이며 이번 가짜 실행에서는 접속·가격·기능을 실시간 확인하지 않았습니다.
유료 가격과 세부 기능의 최신성은 미확인입니다. 실제 고객 증거와 시장 수요는 미검증입니다.
디자이너는 가상의 인터뷰 자료와 함께 가입 정상·오류 흐름, 시간 선택·예약 확인을 설계합니다.
`;
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const excludesPayment = (text: string) => /결제|payment/i.test(text) && /제외|삭제|제거|빼|drop|exclude/i.test(text);
const scopeExcludesPayment = (scope: { exclusions?: readonly string[]; limits?: readonly string[] }) =>
  scope.exclusions?.some(s => /결제|payment/i.test(s)) || scope.limits?.some(s => /예약\s*확인|시간\s*선택/.test(s) && !/결제|payment/i.test(s));
const instructionScope = (input: TaskInstructionsInput) => ({ exclusions: input.exclusions?.map(x => x.text), limits: input.limits?.map(x => x.text) });
/** Describe observable demo behavior, never fabricate external verification. */
function conditionResponse(condition: string, prototype: boolean, excludePayment: boolean): string {
  const parts: string[] = [];
  if (/실제|접속|확인\s*날짜|확인일|최신|가격|인터뷰|고객\s*검증/.test(condition)) parts.push('시연용: 실제 확인 없음. 실제 접속 날짜·최신 가격·고객 증거는 미확인입니다.');
  if (prototype) {
    if (/버튼|모의/.test(condition)) parts.push('모든 동작 버튼은 로컬 화면 상태만 바꾸는 시연용 모의 버튼입니다. data-go 버튼은 show 함수로 화면을 전환하고, 가입 제출은 preventDefault로 서버 전송을 막으며, 예약 확인·완료·초기화 버튼은 브라우저 메모리의 표시만 바꿉니다. 실제 계정 생성·예약 요청·청구·외부 통신은 없습니다.');
    if (/가입|오류|재입력|입력|이메일/.test(condition)) parts.push('가입 흐름: 가상 이름과 이메일 입력 → 가입하고 시간 선택. 오류 흐름: 오류 안내 후 입력값을 유지하며 수정해 재입력합니다. 이름 공백과 이메일 형식을 검사합니다.');
    if (/시간|예약|확인|흐름|화면|상호작용|클릭|이동/.test(condition)) parts.push('시간 선택: 10:00·14:00·16:00 KST 중 선택 → 예약 확인 → 예약 요약 → 예약 완료. 미선택 시 오류 안내, 이전·시간 바꾸기·처음부터 체험 버튼으로 이동합니다. 예약 요약과 완료에 선택 시간이 표시됩니다.');
    if (/개인정보|외부|API|저장|배포|로컬|HTML|파일|체크리스트/.test(condition)) parts.push('구현 확인 체크리스트: 단일 HTML 안에 CSS와 JavaScript 포함; 로컬 브라우저에서 열기; 외부 script·스타일·라이브러리 없음; fetch·XMLHttpRequest·외부 API 호출 없음; 쿠키·localStorage·서버 저장 없음; 가상 이름·이메일만 메모리에서 표시; 실제 개인정보 수집·공개 배포 없음.');
    if (/결제|payment/i.test(condition)) parts.push(excludePayment ? '결제 화면·모의 결제 버튼·처리 코드를 제외했습니다. 예약 요약에서 바로 예약 완료로 이동합니다.' : '결제 모형은 시연 금액 0원이며 모의 결제 버튼으로 완료합니다. 실제 청구·결제 서비스 연결 없음.');
  } else {
    if (/조사|비교|대안|출처|서비스|공개|근거/.test(condition)) parts.push('시연용 가상 비교: Calendly https://calendly.com/ 는 링크 기반 시간 선택, Cal.com https://cal.com/ 은 예약 구성, Google Calendar https://support.google.com/calendar/answer/10729749 는 캘린더 예약을 비교할 출처 후보입니다. 실제 접속·기능·가격은 확인하지 않았습니다.');
    if (/가설|요약|관찰|시사점|흐름|문제/.test(condition)) parts.push('시연용 가설: 소규모 팀은 일정 조율과 재조율이 어렵습니다. 가입→시간 선택→예약 확인 흐름을 가상 인터뷰 자료와 비교해 설계하며 실제 시장 수요는 미검증입니다.');
  }
  return parts.join(' ') || '시연용: 실제 확인 없음. 이 조건에 대한 별도 근거는 만들지 않았으며 담당자의 직접 확인이 필요합니다.';
}
function conditionSections(input: TaskInstructionsInput, prototype: boolean, excludePayment: boolean): string {
  return [...(input.exclusions ?? []).map(x => `제외: ${x.text}`), ...(input.limits ?? []).map(x => `범위: ${x.text}`), ...input.handoffConditions.map((c, i) => `### ${i + 1}. ${c.text}\n${conditionResponse(c.text, prototype, excludePayment)}`)].join('\n\n');
}
export function prototypeHtml(input: TaskInstructionsInput, excludePayment: boolean): string {
  excludePayment ||= !!scopeExcludesPayment(instructionScope(input));
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>Interview Loop 시연</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:17px/1.6 sans-serif;max-width:640px;margin:32px auto;padding:16px;color:#183a2c}input,select,button{font:inherit;padding:10px;margin:6px}label{display:block}button{cursor:pointer}section{padding:16px;border:1px solid #aecaba;border-radius:12px}[hidden]{display:none}#error{color:#a32020}</style>
<body><h1>Interview Loop</h1><p>시연용 가상 자료입니다. 가상 이름과 이메일만 입력하세요. 실제 개인정보 저장·외부 서비스 연결·실제 결제는 없습니다.</p>
<p>설계된 화면 목록: 시작(고객 인터뷰 예약), 가입, 시간 선택, 예약 요약, ${excludePayment ? '' : '결제 모형, '}예약 완료. 각 화면은 아래 버튼으로 이동하며 이름·이메일·시간 선택 오류를 고쳐 다시 진행할 수 있습니다.</p>
${excludePayment ? '<p>제외: 결제 화면과 모의 결제 버튼. 해당 화면·버튼·처리 코드는 이 파일에서 제거했으며 예약 확인 후 바로 완료합니다.</p>' : ''}
<p id="step" role="status">시작</p><p id="error" role="alert"></p>
<section data-screen="intro"><h2>고객 인터뷰 예약</h2><p>가입 후 KST 기준 시간을 골라 예약을 체험합니다.</p><button data-go="signup-step">예약 체험 시작</button></section>
<section data-screen="signup-step" hidden><h2>가입</h2><form id="signup" novalidate><label>가상 이름 <input id="name" required></label><label>가상 이메일 <input id="email" type="email" required></label><button>가입하고 시간 선택</button><button type="button" data-go="intro">이전</button></form></section>
<section id="booking" data-screen="booking" hidden><h2>시간 선택</h2><label>예약 시간 (KST)<select id="slot"><option value="">선택하세요</option><option>10:00</option><option>14:00</option><option>16:00</option></select></label><button data-go="signup-step">이전</button><button id="reserve">예약 확인</button></section>
<section data-screen="summary-step" hidden><h2>예약 요약</h2><p id="summary"></p><button data-go="booking">시간 바꾸기</button>${excludePayment ? '<button id="finish">예약 완료</button>' : '<button data-go="payment">결제 모형 보기</button>'}</section>
${excludePayment ? '' : '<section data-screen="payment" hidden><h2>결제 모형</h2><p>시연 금액 0원 · 실제 청구 없음</p><button data-go="summary-step">이전</button><button id="finish">모의 결제</button></section>'}
<section data-screen="complete" hidden><h2>예약 완료</h2><p id="confirmation" role="status"></p><button id="reset">처음부터 체험</button></section>
<details><summary>작업 조건과 확인 한계</summary><h2>인계 조건 확인</h2><p>시연용 가상 자료의 조건별 대응입니다. 구현 여부는 실제 HTML 동작과 코드로 확인해야 합니다.</p><pre>${escape(conditionSections(input, true, excludePayment))}</pre><p>가입 오류는 이메일 형식 안내 후 입력을 유지합니다. 예약 확인 후 선택 시간이 표시됩니다. 이 파일을 로컬 브라우저에서 열어 버튼을 확인하세요.</p></details>
<script>
const get=id=>document.getElementById(id), labels={'intro':'시작','signup-step':'가입','booking':'시간 선택','summary-step':'예약 확인',${excludePayment ? '' : "'payment':'모형',"}'complete':'완료'};
function show(id){document.querySelectorAll('[data-screen]').forEach(s=>s.hidden=s.dataset.screen!==id);get('step').textContent=labels[id];get('error').textContent='';}
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>show(b.dataset.go));
get('signup').addEventListener('submit',e=>{e.preventDefault();if(!get('name').value.trim()){get('error').textContent='이름을 입력해 주세요';get('name').focus();return;}if(!get('email').checkValidity()||!/^[^ @]+@[^ @]+[.][^ @]+$/.test(get('email').value)){get('error').textContent='이메일 형식을 확인해 주세요';get('email').focus();return;}show('booking');});
get('reserve').onclick=()=>{if(!get('slot').value){get('error').textContent='예약 시간을 선택해 주세요';get('slot').focus();return;}get('summary').textContent=get('name').value+' · '+get('email').value+' · '+get('slot').value+' KST';show('summary-step');};
get('finish').onclick=()=>{get('confirmation').textContent=get('slot').value+' KST 예약이 확인되었습니다. (가상)';show('complete');};
get('reset').onclick=()=>{get('signup').reset();get('slot').value='';get('summary').textContent='';get('confirmation').textContent='';show('intro');};
</script></body></html>`;
}

/** Explicit demo transport: real files and normal reports, never PM verdicts or ledger writes. */
export class FakeConnector implements SessionConnector {
  private listeners = new Set<(e: SessionEvent) => void>();
  private sessions = new Map<string, { threadId: string; workspace: string }>();
  private runs = new Map<string, { input: TaskInstructionsInput; turnId: string; timer?: ReturnType<typeof setTimeout>; index: number; excludePayment: boolean; generation: number; finished: boolean }>();
  constructor(private root: string, private generate?: RevisionGenerator, private readyToFinish: (agentId: string, planVersion: number) => boolean = () => true, private delayMs = 2000,
    private currentTask?: (taskId: string) => Promise<{ title: string; handoffConditions: readonly string[]; exclusions?: readonly string[]; limits?: readonly string[] } | undefined>) {}
  async startSession(agentId: string, projectId: string) {
    const session = { threadId: `fake-${projectId}-${agentId}`, workspace: path.join(this.root, encodeURIComponent(projectId), encodeURIComponent(agentId)) };
    mkdirSync(session.workspace, { recursive: true }); this.sessions.set(agentId, session); return session;
  }
  async startTask(agentId: string, input: TaskInstructionsInput) {
    const old = this.runs.get(agentId); clearTimeout(old?.timer);
    const run = { input: structuredClone(input), turnId: `fake-${randomUUID()}`, index: 0, excludePayment: !!scopeExcludesPayment(instructionScope(input)) || input.decisions.some(d => excludesPayment(d.text)), generation: 0, finished: false };
    this.runs.set(agentId, run);
    setTimeout(() => {
      if (this.runs.get(agentId) !== run) return;
      for (const handler of this.listeners) handler({ type: 'turn', status: 'started', agentId, taskId: run.input.taskId, threadId: this.sessions.get(agentId)!.threadId, turnId: run.turnId });
    }, 0);
    this.schedule(agentId); return run.turnId;
  }
  private emit(agentId: string, report: Report) {
    const run = this.runs.get(agentId)!, session = this.sessions.get(agentId)!;
    const index = run.index++;
    for (const handler of this.listeners) handler({ type: 'report', agentId, taskId: run.input.taskId, threadId: session.threadId, turnId: run.turnId, itemId: `fake-${index}`, index, report });
  }
  private schedule(agentId: string) {
    const run = this.runs.get(agentId)!; clearTimeout(run.timer);
    run.timer = setTimeout(() => { void this.finish(agentId).catch(() => {
      if (this.runs.get(agentId) === run) {
        this.emit(agentId, { type: 'question', taskId: run.input.taskId, question: '시연 자료를 준비하지 못했습니다. 작업 조건을 확인해 주세요.' });
        this.complete(agentId);
      }
    }); }, this.delayMs);
  }
  private async finish(agentId: string) {
    const run = this.runs.get(agentId)!;
    if (!this.readyToFinish(agentId, run.input.planVersion)) { this.schedule(agentId); return; }
    const generation = run.generation;
    const current = await this.currentTask?.(run.input.taskId);
    if (this.runs.get(agentId) !== run || generation !== run.generation) return;
    if (current) {
      run.input.taskTitle = { ...run.input.taskTitle, text: current.title };
      run.input.handoffConditions = current.handoffConditions.map(text => ({ text, sourceId: `plan:${run.input.planVersion}` }));
      run.input.exclusions = (current.exclusions ?? []).map(text => ({ text, sourceId: `plan:${run.input.planVersion}` }));
      run.input.limits = (current.limits ?? []).map(text => ({ text, sourceId: `plan:${run.input.planVersion}` }));
      run.excludePayment = !!scopeExcludesPayment(current) || run.excludePayment;
    }
    const prototype = agentId === 'prototype-agent';
    let content = prototype ? prototypeHtml(run.input, run.excludePayment) : `${research}\n## 인계 조건 확인\n${conditionSections(run.input, false, run.excludePayment)}`;
    if (!prototype && this.generate) content += '\n## 인계 조건별 시연 보완\n' + await this.generate({ title: run.input.taskTitle.text, handoffConditions: run.input.handoffConditions.map(c => c.text), request: '시연용 조사 보고서의 조건별 근거를 구체화하세요. 실제 조사라고 주장하지 말고 출처 후보와 미확인 사항을 구분하세요.', previous: [{ name: 'research.md', mimeType: 'text/markdown', content }] });
    if (this.runs.get(agentId) !== run || generation !== run.generation) return;
    const file = `${prototype ? 'prototype' : 'research'}-v${run.input.planVersion}-${run.index}.${prototype ? 'html' : 'md'}`;
    writeFileSync(path.join(this.sessions.get(agentId)!.workspace, file), content);
    this.emit(agentId, { type: 'result_report', taskId: run.input.taskId, planVersion: run.input.planVersion, summary: `시연용 가상 자료: ${run.input.taskTitle.text}`, files: [{ path: file, description: prototype ? '로컬에서 여는 클릭 가능한 HTML' : '출처 후보와 확인 한계를 구분한 조사 보고서' }], limitations: ['시연용 가상 자료이며 실제 조사·고객 검증이 아닙니다.'] });
    this.complete(agentId);
  }
  private complete(agentId: string) {
    const run = this.runs.get(agentId)!; run.finished = true;
    for (const handler of this.listeners) handler({ type: 'turn', status: 'completed', agentId, taskId: run.input.taskId, threadId: this.sessions.get(agentId)!.threadId, turnId: run.turnId });
  }
  async sendUpdate(agentId: string, input: UpdateInstructionsInput) {
    const run = this.runs.get(agentId); if (!run || run.finished) return { sent: false as const, reason: '진행 중인 턴이 없습니다.' };
    run.generation++; run.input.planVersion = input.toVersion;
    run.excludePayment ||= input.drop.some(s => /결제|payment/i.test(s)) || input.change.some(excludesPayment);
    setTimeout(() => { if (this.runs.get(agentId) === run) this.emit(agentId, { type: 'acknowledge_update', updateId: input.updateId, planVersion: input.toVersion, applied: input.change, dropped: input.drop }); }, 0);
    this.schedule(agentId); return { sent: true as const };
  }
  async continueTask(agentId: string, input: ContinueTaskInput) {
    const turnId = await this.startTask(agentId, { ...input.task, taskId: input.taskId, planVersion: input.planVersion });
    await this.sendUpdate(agentId, input.update);
    return turnId;
  }
  onEvent(handler: (e: SessionEvent) => void) { this.listeners.add(handler); return () => { this.listeners.delete(handler); }; }
  async stop(agentId?: string) {
    for (const [id, run] of this.runs) if (!agentId || id === agentId) { clearTimeout(run.timer); this.runs.delete(id); }
    if (!agentId) this.listeners.clear();
  }
}
