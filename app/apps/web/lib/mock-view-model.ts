// 장면 3 중간 상태의 가짜 뷰 모델. 실제 API(Y3)가 붙기 전까지 화면을 그리는 데 쓴다.
// 디자이너가 가용 시간 감소를 알렸고, 사용자가 "프로토타입이 밀리나?"라고 물은 직후다.
import type { VmCard, VmMember, VmMessage, VmPmJudgement, VmRoadmap, ViewModel } from "./view-model";

export const mockMembers: VmMember[] = [
  { id: "owner", kind: "human", displayName: "사용자", role: "결정권자", weeklyHours: 20 },
  { id: "designer", kind: "human", displayName: "디자이너", role: "흐름·상세 설계", weeklyHours: 5 },
  { id: "reviewer", kind: "human", displayName: "검토자", role: "사용자 검토", weeklyHours: 7 },
  { id: "pm", kind: "pm", displayName: "PM", role: "지휘자" },
  { id: "prototype-agent", kind: "agent", displayName: "프로토타입 Agent", role: "프로토타입 제작", busy: true },
  { id: "research-agent", kind: "agent", displayName: "조사 Agent", role: "자료 조사" },
];

const messages: VmMessage[] = [
  { id: "m1", authorId: "system", kind: "system", text: "장면 1–3 시나리오를 시작했어요. 목표: 2주 안에 고객 반응 확인", at: "2026-09-28T00:00:00Z", attachments: [] },
  { id: "m2", authorId: "owner", kind: "human", text: "2주 안에 고객 반응을 확인하고 싶어요. 지금 합의한 계획으로 시작해 주세요.", at: "2026-09-28T00:01:00Z", attachments: [] },
  {
    id: "m3", authorId: "pm", kind: "pm", at: "2026-09-28T00:02:00Z", attachments: [],
    text: "계획 v1로 시작합니다. 디자이너가 흐름 초안을 넘기면 프로토타입 Agent가 이어받고, 검토자가 가입·결제 흐름을 확인합니다.",
    pm: { kind: "summary", reason: "계획이 확정되어 모두가 같은 순서를 알아야 함", evidence: ["plan_committed v1", "goal_set: 2026-10-12 기한"] },
  },
  {
    id: "m4", authorId: "designer", kind: "human", text: "흐름 초안 올렸어요.", at: "2026-09-29T02:10:00Z",
    attachments: [{ id: "a1", name: "flow.md", url: "#flow.md" }],
  },
  {
    id: "m5", authorId: "designer", kind: "human", text: "오류 흐름도 보완했어요.", at: "2026-09-29T05:40:00Z",
    attachments: [{ id: "a2", name: "flow-v2.md", url: "#flow-v2.md" }],
  },
  { id: "m6", authorId: "prototype-agent", kind: "agent", text: "flow-v2.md를 받아 가입 화면 프로토타입을 만들고 있어요. 결제 화면은 흐름 확정 후 진행할게요.", at: "2026-09-29T06:00:00Z", attachments: [] },
  { id: "m7", authorId: "designer", kind: "human", text: "목요일에 휴가라 이번 주 가용 시간이 10시간에서 5시간으로 줄어요. 상세 설계는 다음 주에 드려도 될까요?", at: "2026-09-30T01:00:00Z", attachments: [] },
  { id: "m8", authorId: "owner", kind: "human", text: "그럼 프로토타입이 밀리나?", at: "2026-09-30T01:03:00Z", attachments: [] },
  {
    id: "m9", authorId: "pm", kind: "pm", at: "2026-09-30T01:04:00Z", attachments: [],
    text: "프로토타입은 흐름 초안에만 의존해서 바로 밀리지 않아요. 다만 상세 설계가 다음 주로 가면 예상 종료가 10월 10일–15일로 늘어 기한(10월 12일)을 최대 3일 넘길 수 있어요. 디자이너 쪽 부족 시간은 5시간입니다.",
    pm: {
      kind: "answer",
      reason: "사용자가 직접 물었고, 답에 필요한 사실(의존 관계·가용 시간)이 기록에 있음",
      evidence: ["availability_updated: designer 10→5h", "task prototype dependsOn design(완료)", "forecast: 10/10–10/15, 기한 10/12"],
    },
  },
];

const allCards: VmCard[] = [
  {
    kind: "plan_approval", id: "card-plan-2", planVersion: 2, forMemberId: "owner",
    reason: "디자이너 가용 시간이 줄어 상세 설계를 다음 주로 옮기고, 프로토타입은 흐름 초안 기준으로 먼저 진행합니다.",
    tasks: [
      { id: "design", title: "흐름 초안", assigneeName: "디자이너", dependsOn: [] },
      { id: "prototype", title: "프로토타입(가입 흐름)", assigneeName: "프로토타입 Agent", dependsOn: ["design"] },
      { id: "review", title: "사용자 검토", assigneeName: "검토자", dependsOn: ["prototype"] },
      { id: "detail", title: "상세 설계(다음 주)", assigneeName: "디자이너", dependsOn: [] },
    ],
  },
  {
    kind: "authority", id: "card-auth-1", forMemberId: "owner",
    text: "검토자 일정을 하루 앞당기려면 사람 담당 일정 변경 권한이 필요해요. 이번 프로젝트에서 PM이 직접 조정해도 될까요?",
    changeKinds: ["reassign_human", "reschedule"],
  },
  {
    kind: "authority", id: "card-auth-2", forMemberId: "designer",
    text: "상세 설계 마감을 10월 7일로 옮겨도 될까요? 담당자 확인이 필요해요.",
    changeKinds: ["reschedule"],
  },
];

const roadmap: VmRoadmap = {
  planVersion: 1,
  tasks: [
    { id: "design", title: "흐름 초안", assigneeName: "디자이너", status: "done", startDay: 0, endDayMin: 2, endDayMax: 2 },
    { id: "prototype", title: "프로토타입", assigneeName: "프로토타입 Agent", status: "in_progress", startDay: 2, endDayMin: 5, endDayMax: 8 },
    { id: "review", title: "사용자 검토", assigneeName: "검토자", status: "todo", startDay: 8, endDayMin: 10, endDayMax: 12 },
    { id: "detail", title: "상세 설계", assigneeName: "디자이너", status: "blocked", startDay: 3, endDayMin: 12, endDayMax: 17 },
  ],
  blocked: [{ taskId: "detail", reason: "디자이너 이번 주 가용 시간 10→5시간", unblockByName: "사용자" }],
  forecast: {
    ok: true, finishMin: "2026-10-10T00:00:00Z", finishMax: "2026-10-15T00:00:00Z", deadline: "2026-10-12T00:00:00Z", lateDaysMax: 3,
    shortage: [{ memberName: "디자이너", hours: 5 }],
  },
  lastChange: { version: 1, reason: "팀이 확인한 초기 계획" },
};

const pmLog: VmPmJudgement[] = [
  { triggerMessageId: "m2", decision: "speak", reason: "계획 확정을 모두에게 알려야 함", whoseAction: "owner", alreadyKnows: "사용자만 계획을 알고 있음", evidence: ["plan_committed v1"] },
  { triggerMessageId: "m4", decision: "silent", reason: "진행 보고일 뿐 누구의 결정도 필요 없음", whoseAction: null, alreadyKnows: "프로토타입 Agent가 첨부를 이미 받음", evidence: ["result_submitted design"] },
  { triggerMessageId: "m5", decision: "silent", reason: "보완 내용이 다음 작업 조건(오류 흐름)을 채움. 끼어들 이유 없음", whoseAction: null, alreadyKnows: "모두", evidence: ["handoffConditions: 오류 흐름"] },
  { triggerMessageId: "m7", decision: "silent", reason: "디자이너가 사용자에게 직접 물었고, 사용자의 답을 먼저 기다림", whoseAction: "owner", alreadyKnows: "디자이너·사용자", evidence: ["availability_updated designer 5h"] },
  { triggerMessageId: "m8", decision: "speak", reason: "사용자의 질문에 답할 사실이 기록에 있고 아무도 답하지 않음", whoseAction: "pm", alreadyKnows: "없음(예측은 PM만 계산함)", evidence: ["forecast 10/10–10/15", "deadline 10/12"] },
];

export function buildMockViewModel(me: string): ViewModel {
  return {
    mode: "scenario",
    project: { goal: "2주 안에 고객 반응 확인", deadline: "2026-10-12T00:00:00Z" },
    me,
    members: mockMembers,
    messages,
    cards: allCards.filter(c => c.forMemberId === me),
    roadmap,
    pmLog,
    scenario: {
      name: "scene-1-3",
      nextLine: { authorName: "디자이너", text: "초안으로 먼저 가주세요. 결제 쪽은 아직 애매해서 빼면 좋겠어요.", hasAttachment: false },
      done: false,
    },
    busy: true,
  };
}
