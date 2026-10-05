export type Choice = 'login' | 'resend';
export type Phase = 'discussion' | 'proposal' | 'consent' | 'ux-ready' | 'ux-running' | 'ux-draft' | 'code-ready' | 'code-running' | 'code-draft' | 'qa-ready' | 'qa-running' | 'changes' | 'review' | 'handed';
export type Artifact = { version: number; choice: Choice; privacy: boolean; focus: boolean; refined: boolean; kind: 'design' | 'build' };
export type Speaker = 'jiyoon' | 'sang' | 'pm' | 'ux' | 'qa';
export type Entry = { id: number; speaker: Speaker; text: string; kind?: 'issue' | 'proposal' | 'plan' | 'artifact' | 'qa' | 'handoff'; refs?: number[]; choice?: Choice; privacy?: boolean; artifact?: Artifact; passed?: boolean };
export type Snapshot = { phase: Phase; version: number; choice: Choice | null; privacy: boolean; agreed: boolean; shared: Artifact | null; draft: Artifact | null; design: Artifact | null; fixFocus: boolean; refined: boolean; evidence: { version: number; passed: boolean } | null; entries: Entry[]; notice: string };
export type State = Snapshot & { run: number; past: Snapshot[]; future: Snapshot[] };
export type Action = { type: 'propose' | 'agree-ux' | 'agree-dev' | 'object' | 'privacy' | 'start' | 'finish' | 'share' | 'focus' | 'revise' | 'approve' | 'reject' | 'cancel' | 'reset' | 'back' | 'forward'; run: number; phase: Phase; version: number; choice?: Choice; focus?: boolean };
export const choices = { login: { title: '로그인으로 돌아가기', constraint: '기존 로그인 경로 사용', outcome: '오늘 적용 가능' }, resend: { title: '새 링크 다시 받기', constraint: '60초 재발송 제한 안내', outcome: '중복 요청 방지' } };
export const initialHandoff = (run = 0): State => ({ run, past: [], future: [], phase: 'discussion', version: 1, choice: null, privacy: false, agreed: false, shared: null, draft: null, design: null, fixFocus: false, refined: false, evidence: null, notice: '', entries: [
  { id: 1, speaker: 'jiyoon', text: '링크가 만료되면 여기서 막혀요. 다음에 뭘 눌러야 할지 보여주면 좋겠어요.', kind: 'issue' },
  { id: 2, speaker: 'sang', text: '재발송 API는 있어요. 다만 한 번 보내면 60초 동안 다시 보낼 수 없어요.' },
] });
export const isBusy = (phase: Phase) => phase.endsWith('-running');
const snapshot = ({ run: _run, past: _past, future: _future, ...s }: State): Snapshot => s;
const pause = (s: Snapshot): Snapshot => ({ ...s, phase: s.phase === 'ux-running' ? 'ux-ready' : s.phase === 'code-running' ? 'code-ready' : s.phase === 'qa-running' ? 'qa-ready' : s.phase });
export function handoffReducer(s: State, a: Action): State {
  if (a.run !== s.run) return s;
  if (a.type === 'reset') return initialHandoff(s.run + 1);
  if (a.type === 'back' || a.type === 'forward') {
    const source = a.type === 'back' ? s.past : s.future;
    if (!source.length) return s;
    const target = pause(source[source.length - 1]!);
    return { ...target, run: s.run + 1, past: a.type === 'back' ? s.past.slice(0, -1) : [...s.past, pause(snapshot(s))], future: a.type === 'back' ? [...s.future, pause(snapshot(s))] : s.future.slice(0, -1) };
  }
  if (a.version !== s.version) return { ...s, notice: `이전 v${a.version}은 반영하지 않았어요. 현재 v${s.version}을 공유하고 검토해 주세요.` };
  if (a.phase !== s.phase) return s;
  if (a.type === 'cancel' && isBusy(s.phase)) return { ...s, ...pause(snapshot(s)), run: s.run + 1, notice: '취소됨 · 공유된 팀 결과는 그대로예요.', future: [] };
  let n: Snapshot = { ...snapshot(s), notice: '' };
  const push = (e: Omit<Entry, 'id'>) => { n = { ...n, entries: [...n.entries, { ...e, id: n.entries.length + 1 }] }; };
  if (a.type === 'propose' && s.phase === 'discussion' && a.choice) {
    n.choice = a.choice; n.phase = 'proposal';
    push({ speaker: 'sang', text: a.choice === 'login' ? '이번에는 기존 로그인으로 돌아가게 하죠. 오늘 적용할 수 있어요.' : '재발송은 살리고, 60초 제한을 화면에 알려주면 어떨까요?' });
    push({ speaker: 'pm', text: '다음 행동은 분명하게, 연속 요청은 막는 방향이네요. 이 안으로 맞춰볼까요?', kind: 'proposal', choice: a.choice, privacy: s.privacy, refs: [1, 2, n.entries.length] });
  } else if (a.type === 'object' && ['proposal', 'consent'].includes(s.phase)) {
    push({ speaker: 'jiyoon', text: s.choice === 'login' ? '로그인으로 돌아가면 다시 시작해야 하네요. 재발송을 살리는 안도 볼까요?' : '60초를 기다리는 게 부담스러워요. 기존 로그인 경로도 비교해 볼까요?' });
    push({ speaker: 'pm', text: '아직 합의하지 않았어요. 다른 경로를 골라 다시 비교해 주세요.', refs: [n.entries.length] });
    n.phase = 'discussion'; n.choice = null;
  } else if (a.type === 'privacy' && ['proposal', 'consent'].includes(s.phase) && !s.privacy) {
    n.privacy = true; n.phase = 'proposal';
    push({ speaker: 'jiyoon', text: '공용 화면일 수도 있어요. 이메일 주소도 가려주세요.' });
    push({ speaker: 'pm', text: '주소 가리기를 완료 기준에 추가했어요. 바뀐 안을 함께 확인해 주세요.', kind: 'proposal', choice: s.choice!, privacy: true, refs: [1, 2, n.entries.length] });
  } else if (a.type === 'agree-ux' && s.phase === 'proposal') {
    n.phase = 'consent'; push({ speaker: 'jiyoon', text: `좋아요. ${s.choice === 'login' ? '다시 로그인하는 이유를 짧게 쓸게요.' : '언제 다시 보낼 수 있는지 함께 보여줄게요.'}${s.privacy ? ' 주소는 가리고요.' : ''}` });
  } else if (a.type === 'agree-dev' && s.phase === 'consent') {
    n.phase = 'ux-ready'; n.agreed = true;
    push({ speaker: 'sang', text: '동의해요. 그 화면을 받으면 제 Coding Agent와 구현할게요.' });
    push({ speaker: 'pm', text: '두 분의 합의를 작업에 연결했어요. 지윤님의 초안을 상성님 작업의 입력으로 묶을게요.', kind: 'plan', choice: s.choice!, privacy: s.privacy, refs: [n.entries.length - 1, n.entries.length] });
  } else if (a.type === 'start' && ['ux-ready', 'code-ready', 'qa-ready'].includes(s.phase)) {
    n.phase = s.phase === 'ux-ready' ? 'ux-running' : s.phase === 'code-ready' ? 'code-running' : 'qa-running';
  } else if (a.type === 'finish' && isBusy(s.phase)) {
    if (s.phase === 'ux-running') {
      n.phase = 'ux-draft'; n.draft = { version: 0, choice: s.choice!, privacy: s.privacy, focus: false, refined: false, kind: 'design' };
    } else if (s.phase === 'code-running') {
      n.phase = 'code-draft'; n.draft = { ...s.design!, version: s.version, kind: 'build', focus: s.fixFocus, refined: s.refined };
    } else {
      const passed = !!s.shared?.focus;
      n.evidence = { version: s.version, passed };
      push({ speaker: 'qa', text: `공유된 v${s.version}을 확인했어요.`, kind: 'qa', artifact: s.shared!, passed, refs: [s.entries.findLast(e => e.kind === 'artifact')!.id] });
      push({ speaker: 'pm', text: passed ? '합의한 동작과 접근성 근거가 갖춰졌어요. 지윤님, 화면을 최종 검토해 주세요.' : '화면은 나왔지만 키보드 사용자는 버튼을 놓쳐요. 상성님, 이 한 부분만 보완해 주세요.', refs: [n.entries.length] });
      n.phase = passed ? 'review' : 'changes';
    }
  } else if (a.type === 'focus' && s.phase === 'code-draft') {
    n.draft = { ...s.draft!, focus: !!a.focus };
  } else if (a.type === 'share' && s.phase === 'ux-draft') {
    n.phase = 'code-ready'; n.design = s.draft; n.shared = s.draft; n.draft = null;
    push({ speaker: 'jiyoon', text: '제 UX Agent와 만든 초안이에요. 합의한 동작과 문구를 담았어요.', kind: 'artifact', artifact: s.draft!, refs: [s.entries.findLast(e => e.kind === 'plan')!.id] });
    push({ speaker: 'pm', text: '상성님 작업에 이 초안과 완료 기준을 붙였어요. 다시 설명하지 않아도 바로 이어갈 수 있어요.', refs: [n.entries.length] });
  } else if (a.type === 'share' && s.phase === 'code-draft') {
    n.phase = 'qa-ready'; n.shared = s.draft; n.draft = null; n.evidence = null;
    push({ speaker: 'sang', text: `UX 초안을 받아 구현한 v${s.version}입니다. 팀에 결과를 공유할게요.`, kind: 'artifact', artifact: s.draft!, refs: [s.entries.findLast(e => e.kind === 'artifact')!.id] });
    push({ speaker: 'pm', text: '공유된 구현을 QA Agent에 연결했어요. 합의한 동작과 키보드 복귀를 확인합니다.', refs: [n.entries.length] });
  } else if (a.type === 'revise' && s.phase === 'changes') {
    n.phase = 'code-ready'; n.version++; n.fixFocus = true;
    push({ speaker: 'sang', text: '제 Agent와 포커스 복귀를 고칠게요. 합의한 화면과 문구는 유지할게요.' });
  } else if (a.type === 'reject' && s.phase === 'review') {
    n.phase = 'code-ready'; n.version++; n.refined = true; n.fixFocus = true;
    push({ speaker: 'jiyoon', text: '동작은 좋아요. 버튼 문구를 더 직접적으로 바꿔주세요.' });
    push({ speaker: 'pm', text: `문구만 ${s.choice === 'login' ? '“다시 로그인하기”' : '“새 로그인 링크 받기”'}로 보완합니다. 기존 합의와 통과한 동작은 유지할게요.`, refs: [n.entries.length] });
  } else if (a.type === 'approve' && s.phase === 'review' && s.evidence?.passed && s.evidence.version === s.version && s.shared?.version === s.version) {
    n.phase = 'handed';
    push({ speaker: 'jiyoon', text: '좋아요. 화면과 동작 모두 이 버전으로 확정해요.' });
    push({ speaker: 'pm', text: '검토 완료를 기록했어요. 모바일 배포 점검에 이 결과와 결정·QA 근거를 함께 넘깁니다.', kind: 'handoff', artifact: s.shared, refs: [n.entries.length, s.entries.findLast(e => e.kind === 'qa')!.id] });
  } else return s;
  return { ...n, run: s.run + 1, past: [...s.past, snapshot(s)], future: [] };
}
export function nextAction(s: State): string {
  if (s.phase === 'discussion') return '두 사람의 복구 경로 의견 모으기';
  if (s.phase === 'proposal') return '지윤의 UX 동의 기다리기';
  if (s.phase === 'consent') return '상성의 구현 동의 기다리기';
  if (s.phase.startsWith('ux-')) return '지윤의 공유 초안을 구현 작업에 연결';
  if (s.phase.startsWith('code-')) return '공유된 구현이 오면 QA에 연결';
  if (s.phase.startsWith('qa-')) return '공유된 구현과 완료 기준 대조';
  if (s.phase === 'changes') return 'QA 실패 근거를 상성의 보완 작업에 연결';
  if (s.phase === 'review') return '현재 버전에 대한 지윤의 검토 기다리기';
  return '지윤 · QA Agent의 모바일 배포 점검 대기';
}
