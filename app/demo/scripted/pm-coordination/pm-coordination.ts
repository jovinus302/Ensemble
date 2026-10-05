/** Local scripted presentation. PM coordinates; humans judge; execution agents author artifacts. */
export type Phase = 'intro' | 'comparing' | 'discussion' | 'agreement' | 'executing' | 'delivered' | 'revising' | 'complete';
export type Speaker = '서연' | '도윤' | 'PM' | 'Story' | 'UI';
export type DemoMessage = { speaker: Speaker; text: string };
export type PendingCoordination = { kind: 'payment' | 'schedule' | 'clarify'; text: string; status: 'awaiting' | 'held' | 'prepared' | 'deferred' | 'resolved' };
export type PendingChoice = 'preview_only' | 'hold' | 'prepare_only' | 'start_now';
export type DemoState = { pending?: PendingCoordination; phase: Phase; messages: DemoMessage[]; notice: string; revision: number; run: number; history: Snapshot[] };
type Snapshot = Omit<DemoState, 'history' | 'run'>;
export const DISCUSS = '두 번째가 더 재밌어요. 다만 “운명적 구원”은 과해요. “뜻밖의 도움” 정도로 낮추면 어떨까요?';
export const AGREE = '좋아요. 그럼 이 기준으로 화면 한번 볼까요?';
export const CHANGE = 'fiction 안내는 추가하고 노래는 이번 화면에서 빼주세요.';
const m = (speaker: Speaker, text: string): DemoMessage => ({ speaker, text });
export function initialDemo(run = 0): DemoState { return { phase: 'intro', messages: [m('서연', 'Pages는 하루의 메모를 짧은 이야기로 바꾸는 앱이에요. 첫 화면을 같이 보면서 방향을 잡고 싶어요. 실제 있었던 일의 느낌은 살렸으면 해요.'), m('도윤', '그런데 이름만 바꿔도 누군지 알 것 같아요. 같은 회사나 자주 가는 가게가 나오면요. 어디까지 바꿔야 할지 좀 걱정돼요.')], notice: '', revision: 0, run, history: [] }; }
export type DemoAction = { type: 'choose_pending'; choice: PendingChoice; run: number; request: string } | { type: 'start' } | { type: 'send'; text: string; phase: Phase } | { type: 'finish'; run: number; phase: Phase } | { type: 'reset' } | { type: 'back' };
function transition(s: DemoState, phase: Phase, messages: DemoMessage[], revision = s.revision): DemoState {
  const { history, run, ...snapshot } = s;
  return { pending: s.pending, phase, messages: [...s.messages, ...messages], revision, notice: '', run, history: [...history, snapshot] };
}
// Small conservative intent checks for a disclosed fixed demo, not a live language model.
// Concerns and uncertainty always take priority over words that could sound like assent.
function accepts(phase: Phase, text: string): boolean {
  const uncertain = /않|못|아니|안\s*보|반대|보류|아직|모르겠|모르[겠는]|잘 모르|정하지 못|결정하지 못|확정하지|동의하지|하지\s*마|만들지|진행하지|빼지|제외하지|추가하지|넣지|취소|아니[요오]|싫|안\s*(돼|되|할|하겠|만들|빼|넣)|말[아아요]|고민|애매|괜찮을지|걱정/;
  const outsideScope = /실명|정확한\s*장소|외부\s*공개|배포|출시|가명화.{0,15}(꺼|끄|빼|제거|없애)|식별.{0,15}(유지|살리|복원)|3단계.{0,15}(빼|제거|없애)|첫\s*번째|1\s*안/;
  if (uncertain.test(text) || outsideScope.test(text)) return false;
  if (phase === 'discussion') return /(두\s*번째|2\s*안|두\s*번\s*째)/.test(text) && /(재밌|재미|좋|마음에|선호)/.test(text) && /(낮추|낮춰|줄이|줄여|과해|과하|부드럽|순화|뜻밖의 도움)/.test(text);
  if (phase === 'agreement') {
    const compact = text.replace(/\s|[.!?。！？,，]/g, '');
    return /^(?:(?:좋아요|네|알겠어요|그럼))*(?:이기준(?:으로|대로)|그기준으로|합의한기준으로|정한범위로|이방향으로)(?:첫)?(?:화면|미리보기|시안)(?:을|를)?(?:한번)?(?:볼까요|보죠|봅시다|보여주세요|만들어주세요|만들죠|진행해요|진행하죠|확인해볼까요)$/.test(compact);
  }
  const compact = text.replace(/\s|[.!?。！？,，]/g, '');
  const disclosure = '(?:fiction|픽션|허구)(?:안내|표시|문구)(?:는|를|도)?';
  const song = '노래(?:는|를|도)?(?:이번화면에서)?';
  return new RegExp(`^(?:${disclosure}(?:추가하고|넣고|넣어주시고|추가해주시고)${song}(?:빼주세요|빼줘|제외해주세요|제거해주세요)|${song}(?:빼고|제외하고|제거하고)${disclosure}(?:추가해주세요|넣어주세요))$`, 'i').test(compact);
}
/** Fixed scenario branches: a detected extra requirement is a coordination item, never implicit consent. */
function coordinationKind(text: string): PendingCoordination['kind'] | undefined {
  const payment = /결제|payment/i.test(text);
  const schedule = /다음\s*주|내주|next\s*week/i.test(text);
  if ((payment && schedule) || /조건|경우|가능하면|된다면|되면|한다면|지면|하면|라면|다면|을\s*때/.test(text) || ((payment || schedule) && /않|못|아니|말고|하지\s*마|추가하지|안\s*(해|하|넣|되|돼)|취소/.test(text))) return 'clarify';
  if (payment && /없|빼|제외|말고|있으면|예산/.test(text)) return 'clarify';
  if (schedule && /말고|취소|아니|없/.test(text)) return 'clarify';
  if (payment) return /결제.{0,15}(추가|넣|도입|붙)/.test(text) ? 'payment' : 'clarify';
  if (schedule) return 'schedule';
  if (/추가|기능|로그인|구독|공개|배포|출시|내일|나중|다음|이후|먼저.{0,15}(되면|하면)|조건|경우|가능하면|된다면|되면|한다면|지\s*말고/.test(text) || (/(화면|시안|미리보기)/.test(text) && !accepts('agreement', text))) return 'clarify';
}
function requestCoordination(s: DemoState, text: string, kind: PendingCoordination['kind'], displayText = text): DemoState {
  const messages = [m('서연', displayText)];
  if (kind === 'payment') messages.push(
    m('PM', '결제 추가를 새 요구사항으로 기록했습니다. 기존 시안과 섞어 바로 실행하지 않겠습니다. UI는 결제 화면 의존 항목을, Story는 기존 템플릿과의 연결을 확인해 주세요. 아래 답변은 고정 데모의 검토 예시이며 실제 견적은 아닙니다.'),
    m('UI', '고정 검토 예시: 결제에는 가격·실패·완료 화면과 결제 수단 선택이 더 필요합니다. 실제 공수나 완료 시점은 아직 판단할 수 없습니다.'),
    m('Story', '고정 검토 예시: 이번 이야기 템플릿은 결제 없이도 검토할 수 있습니다. 유료 이용 제한 규칙은 별도 사람의 결정이 필요합니다.'),
    m('PM', '서연님, 기존 시안을 지금 보고 결제는 별도 검토로 남길까요, 아니면 시안도 보류하고 결제 범위부터 검토할까요? 도윤님은 선택한 범위의 UX 검토를 이어 주세요.'));
  else if (kind === 'schedule') messages.push(
    m('PM', '화면 확인 희망 시점을 다음 주로 기록했습니다. 지금 UI 제작을 시작하지 않겠습니다. Story는 정리된 기준만 준비해 둘 수 있고, 화면 실행은 별도 판단으로 남깁니다. 서연님, 기준만 정리하고 다음 주까지 보류할까요, 아니면 일정을 바꿔 기존 시안을 지금 볼까요? 실제 캘린더 예약이나 자동 실행은 하지 않습니다.'));
  else messages.push(m('PM', '추가 범위나 조건을 함께 말씀하셨습니다. 원문을 미결 항목으로 남기고 실행은 멈춥니다. 담당 영향이나 일정을 임의로 추정하지 않겠습니다. 어떤 추가 항목과 조건을 먼저 검토할지 나눠 알려 주세요. 이 고정 데모에서 구체적인 조율 예시를 제공하는 범위는 결제 추가와 다음 주 보류입니다.'));
  return { ...transition(s, 'agreement', messages), pending: { kind, text, status: 'awaiting' }, notice: '미결 요구 기록 · 서연의 범위·일정 판단 대기' };
}
function choosePending(s: DemoState, a: Extract<DemoAction, { type: 'choose_pending' }>): DemoState {
  const pending = s.pending;
  if (!pending || s.phase !== 'agreement' || a.run !== s.run || a.request !== pending.text || pending.kind === 'clarify' || ['deferred', 'resolved'].includes(pending.status)) return s;
  if (a.choice === 'hold') {
    if (pending.status === 'held') return s;
    return { ...transition(s, 'agreement', [m('서연', '시안은 보류하고 새 범위부터 검토할게요.'), m('PM', '보류를 기록했습니다. UI 실행은 대기합니다. 미결 항목과 담당 검토를 남기며, 새 승인 전에는 시안을 재개하지 않겠습니다.')]), pending: { ...pending, status: 'held' } };
  }
  if (a.choice === 'prepare_only' && pending.kind === 'schedule') {
    if (pending.status === 'prepared') return s;
    return { ...transition(s, 'agreement', [m('서연', '기준만 정리해 두고 화면은 다음 주에 볼게요.'), m('Story', '준비 메모: 식별 단서 축약 · 표현 낮추기 · fiction 3단계. 화면 제작이나 새 템플릿 실행은 하지 않았습니다. (고정 준비 예시)'), m('PM', '준비 메모를 남겼습니다. 희망 시점은 다음 주, UI 실행은 보류입니다. 실제 예약이나 자동 재개는 없으며 다시 사람의 요청을 받아야 합니다.')]), pending: { ...pending, status: 'prepared' } };
  }
  if ((a.choice === 'preview_only' && pending.kind === 'payment') || (a.choice === 'start_now' && pending.kind === 'schedule')) {
    const payment = pending.kind === 'payment';
    return { ...transition(s, 'executing', [m('서연', payment ? '결제는 별도 검토로 남기고 기존 기준의 시안만 지금 볼게요.' : '일정을 바꿔 기존 기준의 시안을 지금 볼게요.'), m('PM', payment ? '결제 요구는 미결로 유지합니다. 지금은 D1 시안만 Story·UI에 배정하고 도윤님이 검토합니다. 결제 구현은 포함하지 않습니다. (고정 실행)' : '지금 보기로 바꾼 사람의 판단을 기록했습니다. D1 시안만 Story·UI에 배정하고 도윤님이 검토합니다. 다음 주 자동 실행은 없습니다. (고정 실행)')]), pending: { ...pending, status: payment ? 'deferred' : 'resolved' } };
  }
  return s;
}
export function demoReducer(s: DemoState, a: DemoAction): DemoState {
  if (a.type === 'choose_pending') return choosePending(s, a);
  if (a.type === 'reset') return initialDemo(s.run + 1);
  if (a.type === 'back') { const previous = s.history.at(-1); return previous ? { ...previous, run: s.run + 1, history: s.history.slice(0, -1) } : s; }
  if (a.type === 'start' && s.phase === 'intro') return transition(s, 'comparing', [
    m('PM', '지금 목표는 출시가 아니라 첫 화면의 방향을 판단하는 거죠. 이름뿐 아니라 장소·관계도 식별 단서가 될 수 있어요. 말로만 정하지 않도록 Story에게 같은 메모의 두 버전을 부탁하겠습니다. UI 작업은 두 분이 기준을 정한 뒤 시작할게요.'),
    m('PM', 'Story Agent, 실제 장소·관계를 감춘 절제된 버전과 상상을 더한 버전을 각각 짧게 보여 주세요. 서연님은 재미와 방향을, 도윤님은 과한 표현과 식별 단서를 봐주세요. 저는 비교 범위와 다음 담당을 연결하겠습니다.')]);
  if (a.type === 'finish') {
    if (a.run !== s.run || a.phase !== s.phase) return s;
    if (s.phase === 'comparing') return transition(s, 'discussion', [
      m('Story', '비교용 초안 두 개를 만들었습니다. ① “낯선 동네의 작은 가게에서, 오래 알던 누군가가 우산을 건넸다.” ② “비가 길을 지우던 밤, 우산 하나가 운명적 구원처럼 나타났다.” 두 안 모두 이름·정확한 장소·직장 관계는 뺐습니다. 오른쪽에서 비교해 주세요. (고정 예시)'),
      m('서연', '두 번째처럼 약간 상상이 들어가야 Pages답겠어요. 도윤님은 어때요? 너무 과장되거나 누군지 짐작되는 부분이 있나요?'),
      m('PM', '도윤님의 검토를 기다립니다. 지금은 비교 초안만 준비됐고 화면 제작은 시작하지 않았습니다.')]);
    if (s.phase === 'executing') return transition(s, 'delivered', [
      m('Story', '“운명적 구원”을 “뜻밖의 도움”으로 낮췄습니다. 이름·장소·관계 단서 축약과 fiction 3단계를 생성 템플릿에 반영했습니다. (고정 결과)'),
      m('UI', '합의한 기준으로 Pages 첫 화면을 만들었습니다. 오른쪽 미리보기에서 선택지와 문구를 확인해 주세요. (고정 결과)'),
      m('PM', '요청한 템플릿과 화면이 도착했고, 과한 표현 수정도 확인했습니다. 도윤님은 화면을 검토하고 서연님은 이번 수정 범위를 정해 주세요. 최종 적절성은 두 분의 검토로 남겨 두겠습니다.'),
      m('도윤', '서연님, fiction이 섞였다는 안내가 안 보여요. 노래는 이번 첫 화면에서 빼고 나머지 포맷에 집중하면 어떨까요?'),
      m('PM', '두 수정 제안을 받았습니다. 서연님, 반영할 범위를 말씀해 주세요. 그 전에는 v1.0을 유지하겠습니다.')], 1);
    if (s.phase === 'revising') return transition(s, 'complete', [
      m('Story', '노래 템플릿만 제외했습니다. 나머지 포맷과 식별 단서 축약·fiction 3단계는 유지했습니다. (고정 결과)'),
      m('UI', 'fiction 안내를 추가하고 노래 선택지를 제거한 v1.1입니다. 다른 화면 내용은 유지했습니다. (고정 결과)'),
      m('도윤', '안내가 보이고 노래는 빠졌네요. 다른 포맷과 3단계 선택은 그대로예요. 이번 화면 검토는 여기까지로 할게요.'), m('PM', '도윤님의 재검토를 기록했습니다. 요청한 두 변경과 유지 항목을 대조했고, Story·UI의 이번 작업을 마칩니다. 다음 판단은 이 화면을 보고 두 분이 이어가면 됩니다.')], 2);
    return s;
  }
  if (a.type !== 'send' || a.phase !== s.phase || !['discussion', 'agreement', 'delivered'].includes(s.phase)) return s;
  const text = a.text.trim();
  if (!text) return { ...s, notice: '메시지를 입력해 주세요.' };
  if (s.phase === 'agreement') {
    if (s.pending?.text === text) return { ...s, notice: '이미 미결 항목으로 기록했습니다. 사람의 선택을 기다립니다.' };
    const kind = coordinationKind(text);
    if (kind && !s.pending) return requestCoordination(s, text, kind);
    if (kind && s.pending && !s.messages.some(msg => msg.text === text)) return requestCoordination(s, s.pending.text + '\n추가 의견: ' + text, 'clarify', text);
    if (s.pending) {
      if (s.messages.some(msg => msg.text === text)) return { ...s, notice: '같은 의견은 이미 기록했습니다. 미결 항목을 먼저 선택해 주세요.' };
      return { ...s, messages: [...s.messages, m('서연', text), m('PM', '원래 남긴 범위·일정 요청은 아직 해결하지 않았습니다. 아래의 해당 선택으로 무엇을 진행하고 무엇을 남길지 명확히 정해 주세요. 추가로 쓴 의견도 기록했으며 자동 실행하지 않습니다.')], notice: '미결 요청 유지 · 실행 대기' };
    }
  }
  const accepted = accepts(s.phase, text);
  if (s.phase === 'delivered' && s.pending?.kind === 'clarify') {
    if (s.messages.some(msg => msg.text === text)) return { ...s, notice: '이미 기록한 의견입니다. 미결 범위 확인 전에는 v1.0을 유지합니다.' };
    return { ...s, messages: [...s.messages, m('서연', text), m('PM', '추가 범위·일정이 아직 미결입니다. 두 기본 수정만으로 덮어쓰지 않고 v1.0을 유지합니다. 이 고정 데모에서는 이전 단계로 돌아가 수정 요청을 나눠 주세요.')], notice: '미결 요청 유지 · v1.0 보존' };
  }
  const extraRevision = /결제|payment|다음\s*주|내일|일정|로그인|구독|검색|기능|로고|예산|조건|경우|지면|하면|라면|다면|외부|공개|배포|출시|추가로|그리고|더\s*추가|\.\s*[^\s.]/i.test(text);
  if (s.phase === 'delivered' && !accepted && extraRevision) return { ...transition(s, 'delivered', [m('서연', text), m('PM', '기본 두 수정 외에 추가 범위나 시점이 있습니다. 전체 요청을 미결로 남기고 v1.0을 유지합니다. 실제 영향이나 일정을 추정하지 않겠습니다. 수정 요청을 나눠 확인해야 하며, 이 고정 데모의 결제·일정 선택 예시는 첫 시안 요청 단계에서 제공합니다.')]), pending: { kind: 'clarify', text: s.pending ? s.pending.text + '\n추가 수정 요청: ' + text : text, status: 'awaiting' }, notice: '추가 수정 범위 확인 · 실행 대기' };
  if (!accepted && s.messages.some(msg => msg.text === text)) return { ...s, notice: '같은 메시지는 이미 기록했습니다. 작업은 대기 중입니다.' };
  const speaker = s.phase === 'discussion' ? '도윤' : '서연';
  if (!accepted) return { ...s, messages: [...s.messages, m(speaker, text), m('PM', s.phase === 'discussion' ? '검토 의견으로 남겼습니다. 두 번째 안을 선택하는지, 과한 표현은 어떻게 낮출지 함께 알려 주세요. 아직 화면 작업은 시작하지 않겠습니다.' : s.phase === 'agreement' ? '지금 말씀만으로 제작을 맡기지는 않겠습니다. 장소·관계 단서를 줄이고 표현을 낮춘 이 기준으로 첫 화면을 보자는 뜻인지 확인해 주세요.' : '기존 화면을 유지하겠습니다. fiction 안내 추가와 노래 제외, 두 제안을 이번 수정 범위로 맡기는지 알려 주세요.')], notice: '의견 기록 · 필요한 판단을 기다리는 중' };
  if (s.phase === 'discussion') return transition(s, 'agreement', [m('도윤', text), m('서연', '맞아요. “뜻밖의 도움”이면 재미는 남고 덜 과하겠네요. 이름뿐 아니라 장소·관계도 흐리게 해요. 상상 정도는 사용자가 낮음·중간·높음 3단계로 고르면 좋겠어요.'), m('PM', '검토 기준을 정리했습니다: 두 번째 안의 표현을 낮추고 식별 단서를 줄이며, fiction은 3단계로 선택합니다. Story가 템플릿을, UI가 첫 화면을 만들 수 있습니다. 서연님, 이 범위의 미리보기를 맡길까요?')]);
  if (s.phase === 'agreement') return transition(s, 'executing', [m('서연', text), m('PM', 'D1 기록: 사람의 검토를 반영한 첫 화면 미리보기입니다. Story는 표현과 생성 규칙을, UI는 화면을 맡아 주세요. 도윤님은 결과 검토를 이어 주세요. 출시나 외부 공개는 범위에 포함하지 않습니다. (고정 실행)')]);
  return transition(s, 'revising', [m('서연', text), m('PM', 'D2 기록: fiction 안내 추가와 노래 제외만 반영합니다. Story는 노래 템플릿, UI는 안내와 선택지를 수정해 주세요. D1의 식별 단서 축약·3단계와 나머지 포맷은 유지합니다. (고정 실행)')]);
}
