/** Local, scripted presentation state. Never dispatches runtime/provider actions. */
export type Phase = 'intro' | 'discussion' | 'agreement' | 'executing' | 'delivered' | 'revising' | 'complete';
export type Speaker = '서연' | '도윤' | 'PM' | 'Story' | 'UI';
export type DemoMessage = { speaker: Speaker; text: string };
export type DemoState = { phase: Phase; messages: DemoMessage[]; notice: string; revision: number; run: number; history: Snapshot[] };
type Snapshot = Omit<DemoState, 'history' | 'run'>;
export const DISCUSS = '서연님, 인물·장소는 가명화하고 fiction은 3단계로 선택하면 어때요? 재미와 공유 안전을 함께 지킬 수 있어요.';
export const AGREE = '도윤님 의견에 동의해요. B: 자동 가명화와 fiction 3단계로 확정합니다.';
export const CHANGE = 'fiction 포함 안내를 추가하고 노래는 빼주세요.';
const m = (speaker: Speaker, text: string): DemoMessage => ({ speaker, text });
export function initialDemo(run = 0): DemoState { return { phase: 'intro', messages: [m('서연', 'Pages는 하루의 기록을 이야기로 만드는 앱이에요. 사람과 에이전트가 함께 공유 가능한 첫 화면을 완성해요.'), m('PM', '서연·도윤 두 분이 방향을 결정합니다. Story Agent는 생성 템플릿, UI Agent는 화면을 맡습니다. 저는 막힌 결정을 찾고 합의가 실행에 연결되도록 조율하겠습니다.')], notice: '', revision: 0, run, history: [] }; }
export type DemoAction = { type: 'start' } | { type: 'send'; text: string; phase: Phase } | { type: 'finish'; run: number; phase: Phase } | { type: 'reset' } | { type: 'back' };
function transition(s: DemoState, phase: Phase, messages: DemoMessage[], revision = s.revision): DemoState {
  const { history, run, ...snapshot } = s;
  return { phase, messages: [...s.messages, ...messages], revision, notice: '', run, history: [...history, snapshot] };
}
export function demoReducer(s: DemoState, a: DemoAction): DemoState {
  if (a.type === 'reset') return initialDemo(s.run + 1);
  if (a.type === 'back') {
    const previous = s.history.at(-1);
    return previous ? { ...previous, run: s.run + 1, history: s.history.slice(0, -1) } : s;
  }
  if (a.type === 'start' && s.phase === 'intro') return transition(s, 'discussion', [
    m('서연', '실제 이름과 장소를 살리고 fiction은 자유롭게 만들고 싶어요. 그래야 내 이야기처럼 느껴지죠.'),
    m('도윤', '서연님, 그 이야기를 feed에 공유하면 다른 사람의 정보도 드러나요. 실명 그대로 공유하는 방향에는 반대해요.'),
    m('PM', '두 기준이 충돌해 Story·UI 작업을 멈췄습니다. 도윤님, 서연님과 절충안을 논의해 주세요. 최종 결정은 서연님께 묻겠습니다.')]);
  if (a.type === 'finish') {
    if (a.run !== s.run || a.phase !== s.phase) return s;
    if (s.phase === 'executing') return transition(s, 'delivered', [m('Story', 'B 결정에 맞춘 가명화·fiction 3단계 템플릿 v1을 반영했습니다. (데모)'), m('UI', 'Pages v1.0 화면에 같은 기준을 반영했습니다. 오른쪽 미리보기에서 확인해 주세요. (데모)'), m('PM', 'D1 반영을 확인했습니다. 도윤님, 공유 화면을 검토하고 서연님과 수정 범위를 맞춰 주세요.'), m('도윤', '서연님, 화면에 fiction 안내가 없네요. 노래도 이번 범위에서는 빼고 세 포맷에 집중하면 어떨까요?'), m('PM', '도윤님의 검토 의견 두 건입니다. 서연님, 반영할 범위를 채팅으로 확정해 주세요.')], 1);
    if (s.phase === 'revising') return transition(s, 'complete', [m('Story', '노래 템플릿만 제외했습니다. 동화·숏폼·에세이와 가명화 기준은 유지했습니다. (데모)'), m('UI', 'fiction 안내 추가, 노래 선택 제거를 v1.1에 반영했습니다. (데모)'), m('PM', '데모 확인 완료: fiction 안내 있음 · 노래 없음 · 가명화·3단계 유지. 사람의 합의 → PM의 의존 작업 조율 → 결과 변경까지 연결했습니다. 외부 도구나 실제 모델은 실행하지 않았습니다.')], 2);
    return s;
  }
  if (a.type !== 'send' || a.phase !== s.phase || !['discussion', 'agreement', 'delivered'].includes(s.phase)) return s;
  const text = a.text.trim();
  if (!text) return { ...s, notice: '메시지를 입력해 주세요.' };
  const expected = s.phase === 'discussion' ? DISCUSS : s.phase === 'agreement' ? AGREE : CHANGE;
  // A future gate's sentence may have been sent as an opinion earlier. It must
  // remain usable at its own gate; stale submissions are already phase-guarded.
  if (text !== expected && s.messages.some(msg => msg.text === text)) return { ...s, notice: '같은 메시지는 이미 전송되었습니다.' };
  const speaker = s.phase === 'discussion' ? '도윤' : '서연';
  if (text !== expected) return { ...s, messages: [...s.messages, m(speaker, text), m('PM', s.phase === 'delivered' ? '의견을 기록했습니다. 이 고정 데모는 아래 예시의 두 변경만 실행합니다. 문장을 입력하고 전송하면 해당 부분만 수정합니다.' : '아직 합의로 처리하지 않겠습니다. 관련 작업은 계속 대기합니다. 이 고정 데모에서는 아래 예시 문장을 입력·전송해야 다음 합의 단계로 이동합니다.')], notice: '의견 기록됨 · 결정 대기 유지' };
  if (s.phase === 'discussion') return transition(s, 'agreement', [m('도윤', text), m('서연', '가명화해도 감정과 사건은 살릴 수 있겠네요. 제가 원했던 몰입도 유지되겠어요.'), m('PM', '도윤님의 제안에 서연님이 공감했습니다. 최종 결정은 기획 책임자인 서연님께 있습니다. B로 확정한다는 답을 채팅에 남겨 주세요.')]);
  if (s.phase === 'agreement') return transition(s, 'executing', [m('서연', text), m('PM', 'D1 확정 · 결정자 서연, 제안 도윤: 자동 가명화 + fiction 3단계. 대기 원인을 해소했습니다. Story는 템플릿, UI는 화면 반영을 자동 재개합니다. 도윤님은 결과 화면 검토를 맡아 주세요. (스크립트 데모)')]);
  return transition(s, 'revising', [m('서연', text), m('PM', 'D2 변경 요청 기록 · 서연: fiction 안내 추가, 노래 제외. Story는 노래 템플릿만, UI는 안내·선택 영역만 수정합니다. D1과 나머지 포맷은 유지합니다. (스크립트 데모)')]);
}
