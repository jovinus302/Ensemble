// v3 §7 step 4 — single canonical source for all UI strings, fixed absolute
// coordinates (logical 1440x900, DOM K=2) and per-beat scrollY / appearance
// frames, taken verbatim from storyboard-v3.md §2.
//
// People: 김도윤 (decision maker) / 이서연 (designer). Agents: 조사 Agent
// (#5B84EC), 프로토타입 Agent (#E5764F). PM: AI PM (#2B6A52).

export const BOARD_W = 1440;
export const BOARD_H = 900;

export const AREAS = {
  rail: {x0: 0, x1: 72},
  sidebar: {x0: 72, x1: 352},
  main: {x0: 352, x1: 1032},
  channelHeader: {y0: 0, y1: 64},
  timelineViewport: {y0: 64, y1: 804},
  composer: {x0: 376, x1: 1008, y0: 820, y1: 876},
  rightPanel: {x0: 1032, x1: 1432, y0: 8, y1: 892},
} as const;

// timeline content-space -> board-space: boardY = 80 + contentY - scrollY
export const contentYToBoardY = (contentY: number, scrollY: number) => 80 + contentY - scrollY;
export const TIMELINE_CONTENT_X0 = 376;
export const TIMELINE_CONTENT_W = 632; // 376-1008

export type BeatId = 1 | 2 | 3 | 4 | 5 | 6;

// beat -> scrollY (§2, "비트별 scrollY")
export const SCROLL_Y_FOR_BEAT: Record<BeatId, number> = {
  1: 0,
  2: 0, // 0 -> 80 at f600 (see M4)
  3: 1100,
  4: 1650,
  5: 1650,
  6: 1990,
};

export const people = {
  domyun: {name: '김도윤', role: '사람 · 결정권자', initial: '도', color: '#CDBBA5'},
  seoyeon: {name: '이서연', role: '사람 · 디자이너', initial: '서', color: '#B9C7BE'},
} as const;

export const agents = {
  pm: {name: 'AI PM', color: '#2B6A52'},
  research: {name: '경쟁사 조사 Agent', color: '#5B84EC'},
  prototype: {name: '프로토타입 Agent', color: '#E5764F'},
} as const;

// ---------------------------------------------------------------------------
// Sidebar "팀원 5" (y 360-610, row height 44)
// ---------------------------------------------------------------------------
export interface TeamRow {
  id: string;
  kind: 'pm' | 'human' | 'agent';
  name: string;
  subtitle: string;
  chip?: {label: string; state: 'working' | 'queued' | 'idle'};
}

export const TEAM_ROWS: TeamRow[] = [
  {id: 'pm', kind: 'pm', name: 'AI PM', subtitle: 'PM', chip: {label: '지휘 중', state: 'working'}},
  {id: 'domyun', kind: 'human', name: '김도윤', subtitle: '사람 · 결정권자'},
  {id: 'seoyeon', kind: 'human', name: '이서연', subtitle: '사람 · 디자이너', chip: {label: '대기', state: 'idle'}},
  {id: 'research', kind: 'agent', name: '경쟁사 조사 Agent', subtitle: 'AI', chip: {label: '작업 중', state: 'working'}},
  {id: 'prototype', kind: 'agent', name: '프로토타입 Agent', subtitle: 'AI', chip: {label: '대기', state: 'queued'}},
];

export const SIDEBAR_TEAM_Y0 = 360;
export const SIDEBAR_TEAM_ROW_H = 44;

export const CHANNEL_TITLE = '고객반응-검증';
export const WORKSPACE_TITLE = 'R2P Lab';
export const PROJECT_TITLE = '2주 고객 반응 검증';

// ---------------------------------------------------------------------------
// Timeline messages M1-M15 (contentY ranges, §2 table)
// ---------------------------------------------------------------------------
export interface AssignmentRow {
  who: string;
  what: string;
  chip: {label: string; state: 'ready' | 'waiting'};
}

export type MessageContent =
  | {kind: 'dateDivider'; label: string}
  | {kind: 'human'; speaker: keyof typeof people; time: string; text: string; attachment?: string}
  | {kind: 'pmBubble'; time: string; text: string; inlineLine?: string}
  | {
      kind: 'planCard';
      title: string;
      conclusion: string;
      rows: AssignmentRow[];
      approved: boolean;
      approvedMeta?: string;
    }
  | {kind: 'agentBubble'; agent: keyof typeof agents; text: string; attachment?: string}
  | {
      kind: 'decisionCard';
      text: string;
      options: string[];
    }
  | {
      kind: 'handoffCard';
      fromChain: string[];
      to: string;
      headline: string;
      fields: {label: string; value: string}[];
      receivedBy: string;
    }
  | {kind: 'typingBubble'; agent: keyof typeof agents; text: string; chipFrom: string; chipTo: string; typingLine: string}
  | {
      kind: 'approvalCard';
      title: string;
      fields: {label: string; value: string}[];
      approved: boolean;
      approvedMeta?: string;
    }
  | {
      kind: 'goalCheckCard';
      title: string;
      progressLabel: string;
      remainingLabel: string;
      pmLine: string;
    };

export interface TimelineMessage {
  id: string;
  contentY: [number, number];
  content: MessageContent;
  appearFrame: number;
  beatTag: string; // e.g. "①D", "②L" — informational, per spec table
}

export const MESSAGES: TimelineMessage[] = [
  {id: 'divider', contentY: [0, 24], appearFrame: 0, beatTag: 'D', content: {kind: 'dateDivider', label: '오늘'}},
  {
    id: 'M1',
    contentY: [40, 126],
    appearFrame: 0,
    beatTag: '①D ②L',
    content: {
      kind: 'human',
      speaker: 'domyun',
      time: '오전 10:00',
      text: '2주 안에 이 아이디어의 고객 반응을 확인하자. 나랑 서연님이 같이 할게요.',
    },
  },
  {
    id: 'M2',
    contentY: [142, 542],
    appearFrame: 415,
    beatTag: '②L',
    content: {
      kind: 'planCard',
      title: '계획 v1 · 2주 고객 반응 검증',
      conclusion: '첫 목표: 검증할 고객 문제 하나 확정',
      rows: [
        {who: '조사 Agent', what: '경쟁사·대안 5곳 조사', chip: {label: '바로 시작', state: 'ready'}},
        {who: '김도윤', what: '고객 인터뷰 5건', chip: {label: '바로 시작', state: 'ready'}},
        {who: '이서연', what: '사용 흐름 설계', chip: {label: '대기 · 문제 확정 후', state: 'waiting'}},
        {who: '프로토타입 Agent', what: '프로토타입 제작', chip: {label: '대기 · 흐름 설계 후', state: 'waiting'}},
      ],
      approved: false,
    },
  },
  {
    id: 'M3',
    contentY: [558, 620],
    appearFrame: 545,
    beatTag: '②L',
    content: {kind: 'human', speaker: 'domyun', time: '10:02', text: '좋아, 그렇게 가자.'},
  },
  {
    id: 'M4',
    contentY: [636, 740],
    appearFrame: 600,
    beatTag: 'D',
    content: {
      kind: 'pmBubble',
      time: '',
      text: '조사 Agent와 도윤님 인터뷰는 지금 시작합니다. 서연님과 프로토타입 Agent는 문제가 정해지면 이어서 시작해요.',
    },
  },
  {
    id: 'M5',
    contentY: [756, 880],
    appearFrame: 630,
    beatTag: 'D',
    content: {kind: 'agentBubble', agent: 'research', text: '경쟁사·대안 5곳 정리했어요.', attachment: '경쟁사 조사 보고서.pdf · 열기'},
  },
  {
    id: 'M6',
    contentY: [896, 1000],
    appearFrame: 660,
    beatTag: 'D',
    content: {kind: 'human', speaker: 'domyun', time: '', text: '인터뷰 5건 기록 올렸어요.', attachment: '인터뷰 기록 5건'},
  },
  {
    id: 'M7',
    contentY: [1016, 1196],
    appearFrame: 690,
    beatTag: 'D',
    content: {
      kind: 'decisionCard',
      text: '판단이 필요해요. 이 결정이 있어야 사용 흐름 설계가 시작됩니다.',
      options: ['① 인터뷰 기록 근거', '② 조사 결과 근거'],
    },
  },
  {
    id: 'M8',
    contentY: [1212, 1274],
    appearFrame: 720,
    beatTag: '③L',
    content: {kind: 'human', speaker: 'domyun', time: '', text: '①로 가자.'},
  },
  {
    id: 'M9',
    contentY: [1290, 1400],
    appearFrame: 640,
    beatTag: '③L',
    content: {
      kind: 'pmBubble',
      time: '',
      text: '기록했습니다. 서연님께 맥락을 넘기고, 흐름 설계가 끝나면 프로토타입 작업을 시작할게요.',
      inlineLine: '결정 D1 기록됨 · 되돌리기',
    },
  },
  {
    id: 'M10',
    contentY: [1416, 1766],
    appearFrame: 660,
    beatTag: '③L',
    content: {
      kind: 'handoffCard',
      fromChain: ['조사 Agent', '김도윤'],
      to: '이서연',
      headline: '맥락을 넘겼어요 · 조사·인터뷰 → 이서연',
      fields: [
        {label: '목적', value: '결정된 고객 문제 ①을 푸는 사용 흐름 설계'},
        {label: '배경', value: '인터뷰 5건 · 경쟁사 5곳 조사'},
        {label: '결정 이유', value: '인터뷰에서 반복된 문제 (D1)'},
        {label: '진행 상태', value: '조사·인터뷰 완료, 흐름 설계 시작'},
        {label: '결과·산출물', value: '조사 보고서, 인터뷰 기록 5건'},
      ],
      receivedBy: '이서연 · 확인함',
    },
  },
  {
    id: 'M11',
    contentY: [1782, 1886],
    appearFrame: 870,
    beatTag: '④L',
    content: {
      kind: 'human',
      speaker: 'seoyeon',
      time: '오후 3:12',
      text: '사용 흐름 초안 올렸어요.',
      attachment: '사용 흐름 초안 v1.fig',
    },
  },
  {
    id: 'M12',
    contentY: [1902, 2006],
    appearFrame: 925,
    beatTag: '④L',
    content: {
      kind: 'pmBubble',
      time: '',
      text: '확인했습니다. 결정된 문제 ①을 다루는 흐름이 들어 있어요. 프로토타입 Agent의 작업을 시작합니다.',
      inlineLine: 'T3 인계 조건 충족 · 판정 사유 기록',
    },
  },
  {
    id: 'M13',
    contentY: [2022, 2140],
    appearFrame: 995,
    beatTag: '④L',
    content: {
      kind: 'typingBubble',
      agent: 'prototype',
      text: '기준: 고객 문제 ①, 사용 흐름 초안, 경쟁사 조사 결과.',
      chipFrom: '대기',
      chipTo: '작업 중',
      typingLine: '프로토타입 Agent가 화면을 만드는 중… 2/5 단계',
    },
  },
  {
    id: 'M14',
    contentY: [2156, 2356],
    appearFrame: 1170,
    beatTag: '⑤L',
    content: {
      kind: 'approvalCard',
      title: '검증 승인 · 사용 흐름 초안',
      fields: [
        {label: '목적', value: 'C3.1 흐름이 문제 ①을 다루는지'},
        {label: '작업', value: '사용 흐름 초안 v1'},
        {label: '필요 사항', value: '결정권자 확인'},
      ],
      approved: false,
    },
  },
  {
    id: 'M15',
    contentY: [2372, 2640],
    appearFrame: 1395,
    beatTag: '⑥L',
    content: {
      kind: 'goalCheckCard',
      title: '목표 점검 · 2주 고객 반응 검증',
      progressLabel: '인수 조건 4/5 충족',
      remainingLabel: 'C4.2 고객 3명 반응 관찰 — 아직 증거 없음',
      pmLine: '고객 반응 세션을 계획에 추가할까요?',
    },
  },
];

export const messageById = (id: string) => MESSAGES.find((m) => m.id === id)!;

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------
export const COMPOSER = {
  placeholder: '메시지 보내기 · @로 팀원 호출',
  hint: 'PM이 담당자를 추천해요',
};

// ---------------------------------------------------------------------------
// Right panel = Product State
// ---------------------------------------------------------------------------
export type BadgeState = 'unverified' | 'verified';

export interface Criterion {
  id: string;
  label: string;
  y: [number, number];
  badge: BadgeState;
  reportedTag?: boolean;
}

export const PRODUCT_STATE = {
  goalLabel: '목표',
  goalText: '검증할 고객 문제 하나를 확정하고, 프로토타입에 대한 고객 반응을 확인한다',
  criteria: [
    {id: 'C1.1', label: '인터뷰 기록 5건', y: [244, 300], badge: 'unverified'},
    {id: 'C2.1', label: '경쟁·대안 조사 보고서', y: [300, 356], badge: 'unverified'},
    {id: 'C3.1', label: '사용 흐름이 문제 ①을 다룸', y: [356, 412], badge: 'unverified', reportedTag: true},
    {id: 'C4.1', label: '프로토타입 핵심 단계 동작', y: [412, 468], badge: 'unverified'},
    {id: 'C4.2', label: '고객 3명 반응 관찰', y: [468, 524], badge: 'unverified'},
  ] as Criterion[],
  decisionBlock: {label: 'D1 검증할 고객 문제: 후보 ①', chip: '확정 · 김도윤'},
  evidence: ['인터뷰 기록 5건 · 사람 승인', '조사 보고서 · 사람 승인', '사용 흐름 초안 v1 · 사람 승인'],
};

export const C3_1_CENTER = {x: 1232, y: 384};

// progress fraction (acceptance criteria met / 5) by beat, per §2 "목표 블록"
export const PROGRESS_BY_BEAT: Record<BeatId, number> = {
  1: 0,
  2: 0,
  3: 0,
  4: 2,
  5: 3,
  6: 4,
};
