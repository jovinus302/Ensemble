// v4 round D: one product-state timeline that the team list, right panel and
// plan card all read from, so no surface contradicts another. v3 hard-coded
// the team chips (경쟁사 조사 Agent "작업 중" from the first frame) and always
// drew the panel's D1 decision, evidence rows and C3.1 "보고됨" tag, even
// before any of those existed.
//
// Stages follow content.ts's story (storyboard-v4 beats):
//   pre        opening, before the AI PM speaks          (SF1a)
//   replied    M1b posted, plan not yet proposed/approved (SF1b, ①, ② until approval = SF2)
//   approved   ② "계획 승인": 조사 Agent + 김도윤 start, 이서연/프로토타입 wait (plan card rows)
//   deciding   ③ research + interviews done (M5/M6), D1 decided (M8), handoff not yet arrived
//   decided    ③ context handed to 이서연 (M10 token arrives): 이서연 작업 중
//   submitted  ④ C1.1/C2.1 verified (2/5); M11 draft submitted -> C3.1 "보고됨",
//              이서연 완료, 프로토타입 Agent still 대기
//   started    ④ M12 PM confirms -> M13 프로토타입 Agent 대기 -> 작업 중 (no re-instruction)
//   verified   ⑤ C3.1 verified by evidence (3/5); M14 draft approval shown approved (SF3)
//   goalCheck  ⑥ C4.1 verified (4/5); prototype done; C4.2 still open
import type {MemberId} from './ui/membersV4';

export type TeamStatus = 'directing' | 'working' | 'waiting' | 'done' | null;
export type StageId = 'pre' | 'replied' | 'approved' | 'deciding' | 'decided' | 'submitted' | 'started' | 'verified' | 'goalCheck';

export interface ProductState {
  team: Record<MemberId, TeamStatus>;
  planApproved: boolean;
  progress: number; // 인수 조건 n/5
  verifiedIds: string[];
  reportedIds: string[]; // "보고됨" tag (self-report, not yet verified)
  showDecision: boolean; // D1 block
  evidenceCount: number; // evidence rows shown (0-3)
  approvedMessages: string[]; // plan card M2 / approval card M14 drawn in their approved state
}

const team = (pm: TeamStatus, domyun: TeamStatus, seoyeon: TeamStatus, research: TeamStatus, prototype: TeamStatus) => ({pm, domyun, seoyeon, research, prototype});

export const STATES: Record<StageId, ProductState> = {
  pre: {team: team('waiting', 'waiting', 'waiting', 'waiting', 'waiting'), planApproved: false, progress: 0, verifiedIds: [], reportedIds: [], showDecision: false, evidenceCount: 0, approvedMessages: []},
  replied: {team: team('directing', 'waiting', 'waiting', 'waiting', 'waiting'), planApproved: false, progress: 0, verifiedIds: [], reportedIds: [], showDecision: false, evidenceCount: 0, approvedMessages: []},
  approved: {team: team('directing', 'working', 'waiting', 'working', 'waiting'), planApproved: true, progress: 0, verifiedIds: [], reportedIds: [], showDecision: false, evidenceCount: 0, approvedMessages: ['M2']},
  deciding: {team: team('directing', 'done', 'waiting', 'done', 'waiting'), planApproved: true, progress: 0, verifiedIds: [], reportedIds: [], showDecision: true, evidenceCount: 0, approvedMessages: ['M2']},
  decided: {team: team('directing', 'done', 'working', 'done', 'waiting'), planApproved: true, progress: 0, verifiedIds: [], reportedIds: [], showDecision: true, evidenceCount: 0, approvedMessages: ['M2']},
  submitted: {team: team('directing', 'done', 'done', 'done', 'waiting'), planApproved: true, progress: 2, verifiedIds: ['C1.1', 'C2.1'], reportedIds: ['C3.1'], showDecision: true, evidenceCount: 2, approvedMessages: ['M2']},
  started: {team: team('directing', 'done', 'done', 'done', 'working'), planApproved: true, progress: 2, verifiedIds: ['C1.1', 'C2.1'], reportedIds: ['C3.1'], showDecision: true, evidenceCount: 2, approvedMessages: ['M2']},
  verified: {team: team('directing', 'done', 'done', 'done', 'working'), planApproved: true, progress: 3, verifiedIds: ['C1.1', 'C2.1', 'C3.1'], reportedIds: [], showDecision: true, evidenceCount: 3, approvedMessages: ['M2', 'M14']},
  goalCheck: {team: team('directing', 'done', 'done', 'done', 'done'), planApproved: true, progress: 4, verifiedIds: ['C1.1', 'C2.1', 'C3.1', 'C4.1'], reportedIds: [], showDecision: true, evidenceCount: 3, approvedMessages: ['M2', 'M14']},
};
