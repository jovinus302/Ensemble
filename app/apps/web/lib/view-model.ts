// M4 공통 계약: 서버(Y3)가 작업 기록에서 이 형태를 만들고, 화면(Y2)은 이 형태만 보고 그린다.
// 다른 worker는 수정하지 않는다. 바꿀 필요가 있으면 보고한다.

export type MemberKind = "human" | "agent" | "pm";
export interface VmMember { id: string; kind: MemberKind; displayName: string; role?: string; weeklyHours?: number; busy?: boolean }
export interface VmAttachment { id: string; name: string; url: string }
export interface VmMessage {
  id: string; authorId: string; text: string; at: string; threadId?: string;
  kind: "human" | "pm" | "agent" | "system";
  attachments: VmAttachment[];
  pm?: { kind: "fact" | "summary" | "ask" | "answer" | "nudge"; reason: string; evidence: string[] };
}
export type VmCard =
  | { kind: "plan_approval"; id: string; planVersion: number; forMemberId: string; tasks: { id: string; title: string; assigneeName: string; dependsOn: string[] }[]; reason: string }
  | { kind: "authority"; id: string; forMemberId: string; text: string; changeKinds: string[] };
export interface VmRoadmapTask { id: string; title: string; assigneeName: string; status: string; startDay?: number; endDayMin?: number; endDayMax?: number }
export type VmForecast =
  | { ok: true; finishMin: string; finishMax: string; deadline?: string; lateDaysMax?: number; shortage: { memberName: string; hours: number }[] }
  | { ok: false; reasons: string[] };
export interface VmRoadmap {
  planVersion: number | null; tasks: VmRoadmapTask[];
  blocked: { taskId: string; reason: string; unblockByName?: string }[];
  forecast: VmForecast | null; lastChange?: { version: number; reason: string };
}
export interface VmPmJudgement { triggerMessageId: string; decision: "speak" | "silent"; reason: string; whoseAction: string | null; alreadyKnows: string; evidence: string[] }
export interface ViewModel {
  mode: "scenario" | "free";
  project: { goal?: string; deadline?: string };
  me: string;                       // 현재 화면 사용자(사람 멤버 id)
  members: VmMember[];
  messages: VmMessage[];
  cards: VmCard[];                  // me 에게 보이는 카드만
  roadmap: VmRoadmap;
  pmLog: VmPmJudgement[];           // PM의 말하기/침묵 판단 기록(토글로 보기)
  scenario?: { name: string; nextLine?: { authorName: string; text: string; hasAttachment: boolean }; done: boolean };
  busy: boolean;                    // PM/Agent 처리 중 표시
}
