// 서버-화면 공통 계약: 서버가 작업 기록에서 이 형태를 만들고, 화면은 이 형태만 보고 그린다.
// M8 이후 추가된 필드는 모두 선택 사항이다. 서버가 아직 채우지 않아도 화면은 깨지지 않아야 한다.

export type MemberKind = "human" | "agent" | "pm";
/** weeklyHours: 기본 주간 가용 시간, weeklyHoursThisWeek: 이번 주(서울 기준 월요일 시작)에만 적용되는 예외. */
export interface VmMember { id: string; kind: MemberKind; displayName: string; role?: string; weeklyHours?: number; weeklyHoursThisWeek?: number; busy?: boolean }
export interface VmAttachment { id: string; name: string; url: string }
/** 채널에 한 줄로 남기는 결정 기록(예: "계획 v1 승인 — 사용자, 22:26"). */
export type VmRecord = { kind: "plan_decision"; planVersion: number; approved: boolean; byName: string };
export interface VmMessage {
  id: string; authorId: string; text: string; at: string; threadId?: string;
  kind: "human" | "pm" | "agent" | "system";
  attachments: VmAttachment[];
  pm?: { kind: "fact" | "summary" | "ask" | "answer" | "nudge"; reason: string; evidence: string[] };
  record?: VmRecord;
  /** 이 발언이 안내하는 결정 카드. 카드가 보이는 사람에게는 발언 대신 카드를 그 자리에 보여 준다. cards와 decisionCards 양쪽에서 찾는다. */
  cardId?: string;
  /** 이 발언이 언급한 작업(작업 이름 칩). threadId가 "task:<id>"면 그 작업의 댓글이다. */
  taskIds?: string[];
  /** 화면 전용: 서버 기록 전(보내는 중) 내 메시지. 서버는 채우지 않는다. */
  local?: "sending";
}
export interface VmPlanTask {
  exclusions?: string[]; limits?: string[];
  id: string; title: string; assigneeName: string; dependsOn: string[];
  /** 하위 작업이면 상위 작업 id(같은 계획 안). 계획 승인 카드는 이 값으로 트리를 그린다. */
  parentId?: string;
  /** 추정 작업 시간(최소~최대). */
  hours?: { min: number; max: number };
  /** 예상 완료일(ISO, 최소~최대). 가용 시간이 없으면 계산하지 않는다. */
  expectedEnd?: { min: string; max: string };
  /** 다음 담당에게 넘기기 전에 PM이 확인하는 조건. */
  handoffConditions?: string[];
}
export type VmCard =
  | { kind: "plan_approval"; id: string; planVersion: number; forMemberId: string; tasks: VmPlanTask[]; reason: string; finish?: { min: string; max: string } }
  | { kind: "authority"; id: string; forMemberId: string; text: string; changeKinds: string[] };
/**
 * 결정 요청 카드(사람 호출의 단일 형태). 기존 VmCard(계획 승인·권한)와 따로 둔다: 기존 카드 API(`cards/:id`)와
 * 응답 버튼이 다르고, 결정 요청은 `POST decisions/:id`로 답한다.
 */
export interface VmDecisionCard {
  kind: "decision"; id: string; forMemberId: string;
  requestKind: "plan_change" | "assignment" | "choice" | "missing_info" | "stuck_work";
  question: string;
  /** 항상 있다. 화면은 추천안을 강조한다. evidence는 사람이 읽는 근거 문장. */
  recommendation: { optionId: string; rationale: string; evidence: string[] };
  /**
   * summary: 이 선택지가 하는 일(효과)을 사람이 읽는 말로.
   * answerText: 답변형(missing_info) 카드에서 이 선택지를 고르면 Agent에게 그대로 전달되는 답. 있으면 화면이 바로 고를 수 있는 버튼으로 그린다.
   */
  options: { optionId: string; label: string; tradeoff: string; summary: string[]; answerText?: string }[];
  impact: { taskTitles: string[]; blockedTitles: string[]; deadlineDeltaDays?: number };
  /** "고쳐서 승인"에서 바꿀 수 있는 필드. 없으면 그 버튼을 감춘다. */
  editable?: ("assignee" | "title" | "priority" | "include")[];
  /** choose: 버튼으로 고른다. text: 자유 답변(missing_info). */
  answerMode: "choose" | "text";
  /** 한 사람에게 결정 요청이 3건을 넘으면 넷째부터 셋째 카드에 묶인다(요청 순서). 묶인 요청도 각자 답한다. */
  bundled?: VmDecisionCard[];
}
/** `POST /api/decisions/:id` 본문. */
export interface DecisionAnswer {
  me: string; action: "approve" | "choose" | "edit" | "reject" | "answer";
  optionId?: string; edits?: Record<string, unknown>; text?: string;
}

/** 사람에게 보이는 작업 상태. 칸반 열이 아니라 묶음 기준이다. */
export type VmWorkStatus = "todo" | "in_progress" | "in_review" | "waiting_human" | "blocked" | "done" | "cancelled";
/** 작업 항목. 사람에게 작업 키(ENS-12 같은)는 보이지 않는다: id는 내부 식별자이며 화면에 그리지 않는다. */
export interface VmWorkItem {
  id: string; title: string;
  /** 하위 작업이면 상위 작업 id(깊이 최대 2). */
  parentId?: string;
  ownerId: string; ownerKind: "human" | "agent";
  /** 상위 작업은 하위 작업에서 계산한 상태. */
  status: VmWorkStatus;
  priority: "high" | "normal" | "low";
  /** 라우팅 사유를 사람이 읽는 말로(예: "Agent가 할 수 있는 일이라 바로 맡겼어요"). */
  routingNote?: string;
  /** status가 waiting_human일 때 누구의 어떤 결정을 기다리는지. */
  waitingOn?: { memberId: string; requestId: string };
  /** 하위 작업 id, 계획 순서. */
  childIds: string[];
  /** PM이 대화에서 정리한 맥락. */
  brief?: {
    why: string;
    sources: { messageId: string; excerpt: string }[];
    decisions: { id: string; summary: string }[];
    attachments: VmAttachment[];
    constraints: string[];
  };
  /** 출처: 이 작업을 낳은 대화(채널 메시지로 이동). */
  origin?: { createdByName: string; messageIds: string[] };
  handoffConditions?: string[]; exclusions?: string[]; limits?: string[];
  resolution?: VmRoadmapTask['resolution'];
}
/** 작업 활동 기록 한 줄(원장에서 파생). */
export interface VmActivityItem {
  at: string;
  kind: "created" | "assigned" | "started" | "submitted" | "reviewed" | "revision" | "blocked" | "resumed" | "changed" | "decision_requested" | "decision_resolved" | "comment";
  actorId: string; text: string; messageId?: string;
}
export interface VmWorkTeamRow { memberId: string; currentItemId?: string; state: string; openDecisions: number }
export interface VmWork { items: VmWorkItem[]; team: VmWorkTeamRow[] }
/** `GET /api/tasks/:id` 응답. 상세는 상태 폴링에 싣지 않는다. comments는 threadId "task:<id>" 메시지. */
export interface VmTaskDetail { item: VmWorkItem; activity: VmActivityItem[]; comments: VmMessage[] }

export interface VmRoadmapTask {
  exclusions?: string[]; limits?: string[];
  resolution?: { taskId: string; actions: ('accept' | 'retry' | 'recheck')[] };
  stopped?: boolean;
  id: string; title: string; assigneeName: string; status: string; startDay?: number; endDayMin?: number; endDayMax?: number;
  hours?: { min: number; max: number }; handoffConditions?: string[];
}
export type VmForecast = (
  | { ok: true; finishMin: string; finishMax: string; deadline?: string; lateDaysMax?: number; shortage: { memberName: string; hours: number }[] }
  | { ok: false; reasons: string[] }) & { uncertainty?: { stoppedTaskIds: string[]; warning: string } };
export interface VmRoadmap {
  clockLabel?: string;
  planVersion: number | null; tasks: VmRoadmapTask[];
  blocked: { taskId: string; reason: string; unblockByName?: string }[];
  forecast: VmForecast | null; lastChange?: { version: number; reason: string };
  /** 일정 막대의 0일 기준 시각(ISO). 있으면 D+일 대신 날짜로 표시한다. */
  origin?: string;
}
export interface VmPmJudgement {
  triggerMessageId: string; decision: "speak" | "silent"; reason: string; whoseAction: string | null; alreadyKnows: string; evidence: string[];
  /** 판단 시각(ISO). 있으면 이 순서로 보여 준다. */
  at?: string;
  /** 메시지가 아닌 계기(계획 제안, 작업 시작 등)를 사람이 읽는 말로. */
  triggerLabel?: string;
  /** 말한 경우 실제 발언. */
  spokenText?: string;
}

/** 서버가 지금 무엇을 하고 있는지(계약 2). */
export interface VmActivity {
  kind: "pm_thinking" | "scenario_waiting" | "agent_working" | "idle";
  label: string;                    // 한국어, 예: "PM이 판단 중"
  since: string;                    // ISO
  stalled?: { reason: string; canRetry: boolean; canSkip: boolean; tasks?: { taskId: string; title: string; actions: ('accept' | 'retry' | 'recheck')[] }[] };
}

export interface ViewModel {
  mode: "scenario" | "free";
  /** title: 상단에 보일 짧은 제목(서버가 주면 그 값), synthetic: 시연용 가상 자료 여부(작은 배지). */
  project: { id?: string; goal?: string; deadline?: string; title?: string; synthetic?: boolean };
  me: string;                       // 현재 화면 사용자(사람 멤버 id)
  members: VmMember[];
  messages: VmMessage[];
  cards: VmCard[];                  // me 에게 보이는 카드만
  /** me 에게 열린 결정 요청 카드("내 결정" 탭과 채널 인라인 카드). */
  decisionCards?: VmDecisionCard[];
  /** 작업 패널(작업 트리·팀). */
  work?: VmWork;
  roadmap: VmRoadmap;
  pmLog: VmPmJudgement[];           // PM의 말하기/침묵 판단 기록(토글로 보기)
  scenario?: { name: string; nextLine?: { authorName: string; text: string; hasAttachment: boolean }; done: boolean };
  busy: boolean;                    // PM/Agent 처리 중 표시(activity가 없을 때의 대체)
  activity?: VmActivity;
}

/** 오류 응답(계약 4): 화면은 message를 그대로 보여 준다. */
export interface ApiError { error: { code: string; message: string } }
/** 메시지 전송 응답(계약 1). */
export interface MessageAccepted { accepted: true; messageId: string }
