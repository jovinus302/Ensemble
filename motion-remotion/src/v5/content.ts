// v5 surface content (storyboard-v5.md §0/§1). Generic tools, no product
// names. People are identified by name text only (no voice colors).
export const PEOPLE = {
  doyun: '도윤', // launch owner / decision maker
  jieun: '지은', // marketing
  seoyeon: '서연', // design
  minho: '민호', // support (joins in B6)
} as const;

export const MESSENGER = {
  channel: '출시 준비',
  members: '4명',
  messages: [
    {who: '도윤', text: '출시 일정 점검할게요', mine: false},
    {who: '지은', text: '보도자료 10/30 맞죠?', mine: false},
    {who: '서연', text: '배너 시안 올렸어요', mine: false},
    {who: '도윤', text: '좋아요, 오늘 마무리해요', mine: true},
  ],
  composer: '메시지 입력',
} as const;

export const DESIGN = {
  file: '출시 배너',
  frameLabel: '배너 1200 × 630',
  banner: '10.30 출시',
  sub: '새로운 시작',
  pin: '1',
} as const;

export const MEETING = {
  title: '주간 출시 회의',
  tiles: [
    {name: '도윤', initial: '도', empty: false},
    {name: '지은', initial: '지', empty: false},
    {name: '서연', initial: '서', empty: false},
    {name: 'PM Agent', initial: '', empty: true}, // B1: name tag only, dimmed
  ],
} as const;

export const DOC = {
  title: '출시 보도자료',
  badge: '초안',
  scheduleTitle: '캠페인 일정',
  rows: [
    {item: '보도자료 배포', date: '10/29'},
    {item: '광고 집행', date: '11/1'},
    {item: '뉴스레터 발송', date: '11/2'},
  ],
} as const;

export const AGENT = {
  title: '지은의 Agent',
  privateLabel: '비공개 작업',
  inboxLabel: '공유 요청함',
  inboxEmpty: '요청 없음',
  promptLine: '일정 정리하는 중',
} as const;
