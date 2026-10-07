export type Workspace = 'dev' | 'design' | 'slack' | 'meeting';
export type WorkSource = Extract<Workspace, 'dev' | 'design'>;
export type ContextState = {
  connected: Record<Workspace, boolean>;
  revised: Record<WorkSource, boolean>;
};
export type Action = { type: 'connect'; source: Workspace } | { type: 'revise'; source: WorkSource } | { type: 'reset' };

export const SOURCES: Record<Workspace, { title: string; tool: string; person: string; icon: string; reference: string }> = {
  dev: { title: '개발', tool: '코드 에디터', person: '상성 · 개발자', icon: '⌘', reference: 'login.tsx · 개발자 Agent' },
  design: { title: '디자인', tool: '디자인 캔버스', person: '지윤 · 디자이너', icon: '◈', reference: 'Login / States · 디자이너 Agent' },
  slack: { title: 'Slack', tool: '팀 대화', person: '프로젝트 팀', icon: '#', reference: '#login-release · 범위 합의' },
  meeting: { title: '미팅', tool: '결정과 이유', person: '상성 · 지윤', icon: '◎', reference: '로그인 리뷰 · 결정 01' },
};
export const WORK_SOURCES: WorkSource[] = ['dev', 'design'];
export const initialContext = (): ContextState => ({
  connected: { dev: false, design: false, slack: false, meeting: false },
  revised: { dev: false, design: false },
});

// Independent source events, no timed dialogue or remote execution.
export function contextReducer(state: ContextState, action: Action): ContextState {
  if (action.type === 'reset') return initialContext();
  if (action.type === 'connect') {
    if (state.connected[action.source]) return state;
    return { ...state, connected: { ...state.connected, [action.source]: true } };
  }
  if (!state.connected.meeting || !state.connected[action.source] || state.revised[action.source]) return state;
  return { ...state, revised: { ...state.revised, [action.source]: true } };
}
export function pendingWork(state: ContextState): WorkSource[] {
  return state.connected.meeting ? WORK_SOURCES.filter(source => !state.revised[source]) : [];
}
export function revision(state: ContextState, source: WorkSource): 1 | 2 {
  return state.revised[source] ? 2 : 1;
}
export function companion(state: ContextState, source: Workspace): string {
  if (source === 'slack') return state.connected.slack
    ? '이번 범위는 이메일 로그인입니다. 이 합의와 소셜 로그인 제외 이유를 개발·디자인 작업에 함께 연결했습니다.'
    : '이번 릴리스의 범위를 확인했습니다. 합의를 연결하면 두 작업에서 같은 기준을 볼 수 있습니다.';
  if (source === 'meeting') return state.connected.meeting
    ? '입력 유지와 오류 문구 결정을 두 작업에 전달했습니다. 반영된 결과를 각각 확인할 때까지 남은 일로 유지합니다.'
    : '입력이 지워지면 다시 입력해야 한다는 리뷰 의견이 있습니다. 합의된 결정을 연결해 두 작업에서 확인하도록 하겠습니다.';
  if (state.connected.meeting && !state.revised[source]) return source === 'dev'
    ? '미팅에서 실패 시 입력 유지와 공통 오류 문구를 정했습니다. 현재 구현의 resetForm()과 오류 문구를 바꿔야 합니다. 결정의 출처를 작업에 연결했습니다.'
    : '미팅에서 실패 시 입력 유지와 공통 오류 문구를 정했습니다. 오류 화면에도 입력값과 합의한 문구가 필요합니다. 개발 결과와 함께 확인하겠습니다.';
  if (state.revised[source]) return state.revised[source === 'dev' ? 'design' : 'dev']
    ? '두 산출물에 같은 결정이 반영되었습니다. 이제 구현과 디자인을 함께 검토할 차례입니다. 반영 확인과 최종 검토 완료는 구분합니다.'
    : '이 작업의 v2에서 결정 반영을 확인했습니다. 다른 작업의 반영은 아직 남아 있어 함께 검토하기 전 확인이 필요합니다.';
  if (state.connected.dev && state.connected.design) return '로그인 구현과 화면을 같은 목표에 연결했습니다. 개발에서는 디자인의 상태 구성을, 디자인에서는 구현의 오류 처리를 함께 확인할 수 있습니다.';
  if (state.connected[source]) return source === 'dev'
    ? '로그인 구현을 프로젝트에 연결했습니다. 지윤의 디자인이 공유되면 같은 목표 아래에서 서로의 결과를 확인할 수 있습니다.'
    : '로그인 디자인을 프로젝트에 연결했습니다. 상성의 구현이 공유되면 같은 목표 아래에서 서로의 결과를 확인할 수 있습니다.';
  return source === 'dev'
    ? '이메일 로그인 구현을 지윤의 화면 작업과 연결하겠습니다. 결과를 공유하면 디자인에서 구현의 동작과 제약을 확인할 수 있습니다.'
    : '로그인 폼과 오류 상태를 상성의 구현 작업과 연결하겠습니다. 결과를 공유하면 개발에서 적용할 디자인을 확인할 수 있습니다.';
}
export function codeExample(updated: boolean): string {
  return updated
    ? `// login.tsx · v2 · 설명용 코드 발췌\nconst result = await signIn(email, password);\nif (!result.ok) {\n  // 입력값을 유지하고 오류를 안내한다.\n  setError('이메일 또는 비밀번호를 확인해 주세요.');\n  focusError();\n}`
    : `// login.tsx · v1 · 설명용 코드 발췌\nconst result = await signIn(email, password);\nif (!result.ok) {\n  resetForm();\n  setError('로그인에 실패했습니다.');\n}`;
}
export const ERROR_COPY = '이메일 또는 비밀번호를 확인해 주세요.';
