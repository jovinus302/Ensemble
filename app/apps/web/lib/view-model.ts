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
  /** 이 발언이 안내하는 결정 카드. 카드가 보이는 사람에게는 발언 대신 카드를 그 자리에 보여 준다. */
  cardId?: string;
  /** 화면 전용: 서버 기록 전(보내는 중) 내 메시지. 서버는 채우지 않는다. */
  local?: "sending";
}
export interface VmPlanTask {
  id: string; title: string; assigneeName: string; dependsOn: string[];
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
export interface VmRoadmapTask {
  stopped?: boolean;
  id: string; title: string; assigneeName: string; status: string; startDay?: number; endDayMin?: number; endDayMax?: number;
  hours?: { min: number; max: number }; handoffConditions?: string[];
}
export type VmForecast = (
  | { ok: true; finishMin: string; finishMax: string; deadline?: string; lateDaysMax?: number; shortage: { memberName: string; hours: number }[] }
  | { ok: false; reasons: string[] }) & { uncertainty?: { stoppedTaskIds: string[]; warning: string } };
export interface VmRoadmap {
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
  stalled?: { reason: string; canRetry: boolean; canSkip: boolean };
}

export interface ViewModel {
  mode: "scenario" | "free";
  /** title: 상단에 보일 짧은 제목(서버가 주면 그 값), synthetic: 시연용 가상 자료 여부(작은 배지). */
  project: { id?: string; goal?: string; deadline?: string; title?: string; synthetic?: boolean };
  me: string;                       // 현재 화면 사용자(사람 멤버 id)
  members: VmMember[];
  messages: VmMessage[];
  cards: VmCard[];                  // me 에게 보이는 카드만
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
