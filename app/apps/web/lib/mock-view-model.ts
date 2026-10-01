// 장면 3 중간 상태의 가짜 뷰 모델. 서버 계약 필드(activity 등)가 붙기 전에 화면을 그려 보는 데 쓴다.
// 디자이너가 가용 시간 감소를 알렸고, 사용자가 "프로토타입이 밀리나?"라고 물은 직후다.
import type { VmActivity, VmCard, VmDecisionCard, VmMember, VmMessage, VmPmJudgement, VmRoadmap, VmTaskDetail, VmWork, ViewModel } from "./view-model";

export const mockMembers: VmMember[] = [
  { id: "owner", kind: "human", displayName: "사용자", role: "결정권자", weeklyHours: 20 },
  { id: "designer", kind: "human", displayName: "디자이너", role: "흐름·상세 설계", weeklyHours: 10, weeklyHoursThisWeek: 5 },
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
    pm: { kind: "summary", reason: "계획이 확정되어 모두가 같은 순서를 알아야 함", evidence: ["계획 v1 제안", "메시지 · 사용자: \"2주 안에 고객 반응을 확인하고…\""] },
  },
  {
    id: "m3r", authorId: "system", kind: "system", at: "2026-09-28T00:02:30Z", attachments: [], text: "계획 v1 승인 — 사용자",
    record: { kind: "plan_decision", planVersion: 1, approved: true, byName: "사용자" },
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
  {
    id: "m6b", authorId: "research-agent", kind: "agent", at: "2026-09-29T06:30:00Z", attachments: [{ id: "a3", name: "comparison.md", url: "#comparison.md" }],
    text: "[경쟁 서비스 조사] 조사 Agent 결과\n무엇이 됐나: 예약 서비스 3곳의 가입·예약 흐름을 비교했어요.\n할 일: PM이 인계 조건을 확인했습니다.\n확인할 곳: comparison.md",
  },
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
  {
    id: "m10", authorId: "pm", kind: "pm", at: "2026-09-30T01:06:00Z", attachments: [], taskIds: ["prototype-payment"], cardId: "decision-payment",
    text: "결제 화면 작업은 디자이너 상세 설계를 기다려야 해요. 이번 범위에서 뺄지 결정이 필요해요.",
    pm: { kind: "ask", reason: "범위 변경은 결정권자의 결정", evidence: ["결제 화면 작업이 상세 설계에 의존", "예측: 기한 최대 3일 초과"] },
  },
  {
    id: "m11", authorId: "pm", kind: "pm", at: "2026-09-30T01:20:00Z", attachments: [], taskIds: ["prototype-signup"], cardId: "decision-retry",
    text: "프로토타입 Agent가 가입 오류 처리 기준을 묻고 있어요.",
    pm: { kind: "ask", reason: "Agent가 이 답 없이는 가입 화면을 마칠 수 없음", evidence: ["Agent 질문: 비밀번호 오류 재시도 횟수"] },
  },
];

const allCards: VmCard[] = [
  {
    kind: "plan_approval", id: "card-plan-2", planVersion: 2, forMemberId: "owner",
    reason: "디자이너 가용 시간이 줄어 상세 설계를 다음 주로 옮기고, 프로토타입은 흐름 초안 기준으로 먼저 진행합니다.",
    finish: { min: "2026-10-10T00:00:00Z", max: "2026-10-15T00:00:00Z" },
    tasks: [
      { id: "design", title: "흐름 초안", assigneeName: "디자이너", dependsOn: [], hours: { min: 6, max: 10 }, expectedEnd: { min: "2026-09-30T00:00:00Z", max: "2026-10-01T00:00:00Z" }, handoffConditions: ["가입 정상 흐름과 오류 흐름이 모두 있음"] },
      { id: "prototype", title: "프로토타입(가입 흐름)", assigneeName: "프로토타입 Agent", dependsOn: ["design"], hours: { min: 4, max: 8 }, expectedEnd: { min: "2026-10-03T00:00:00Z", max: "2026-10-06T00:00:00Z" } },
      { id: "prototype-signup", parentId: "prototype", title: "가입 화면", assigneeName: "프로토타입 Agent", dependsOn: [], hours: { min: 2, max: 4 } },
      { id: "prototype-payment", parentId: "prototype", title: "결제 화면", assigneeName: "프로토타입 Agent", dependsOn: ["prototype-signup"], hours: { min: 2, max: 4 } },
      { id: "review", title: "사용자 검토", assigneeName: "검토자", dependsOn: ["prototype"], hours: { min: 3, max: 5 }, expectedEnd: { min: "2026-10-08T00:00:00Z", max: "2026-10-10T00:00:00Z" } },
      { id: "detail", title: "상세 설계(다음 주)", assigneeName: "디자이너", dependsOn: [], hours: { min: 8, max: 12.5 } },
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

// 결정 요청 카드 2개: 범위 결정(선택형)과 Agent 질문(자유 답변형). 둘 다 추천안이 있다.
const decisionCards: VmDecisionCard[] = [
  {
    kind: "decision", id: "decision-payment", forMemberId: "owner", requestKind: "plan_change",
    question: "결제 화면 프로토타입을 이번 범위에서 빼고 가입 흐름만으로 고객 반응을 볼까요?",
    recommendation: { optionId: "drop-payment", rationale: "상세 설계가 다음 주로 밀려 결제 화면을 기다리면 기한을 최대 3일 넘겨요. 고객 반응 확인에는 가입 흐름으로 충분해요.", evidence: ["디자이너 이번 주 가용 시간 10→5시간", "예상 종료 10월 10일–15일, 기한 10월 12일"] },
    options: [
      { optionId: "drop-payment", label: "결제 화면 빼기", tradeoff: "결제 반응은 다음 단계에서 확인", summary: ["결제 화면 작업 취소", "사용자 검토는 가입 흐름만"] },
      { optionId: "keep-payment", label: "그대로 두기", tradeoff: "기한을 최대 3일 넘길 수 있음", summary: ["결제 화면은 상세 설계 후 진행"] },
      { optionId: "hold", label: "보류", tradeoff: "결정 전까지 결제 화면 작업이 멈춰 있음", summary: ["변경 없음"] },
    ],
    impact: { taskTitles: ["결제 화면", "사용자 검토"], blockedTitles: ["결제 화면"], deadlineDeltaDays: -3 },
    editable: ["include"], answerMode: "choose",
  },
  {
    kind: "decision", id: "decision-retry", forMemberId: "owner", requestKind: "missing_info",
    question: "가입 화면에서 비밀번호를 몇 번 틀리면 잠글까요?",
    recommendation: { optionId: "five", rationale: "흐름 초안에 기준이 없고, 비교한 서비스 3곳 중 2곳이 5회예요.", evidence: ["comparison.md: 예약 서비스 3곳 비교", "flow-v2.md 오류 흐름"] },
    options: [
      { optionId: "five", label: "5회", tradeoff: "", summary: ["Agent에게 \"5회\"로 전달"], answerText: "5회" },
      { optionId: "later", label: "나중에 정하기", tradeoff: "잠금 없이 시안을 만들고 검토 때 정함", summary: ["Agent에게 잠금 없이 진행하라고 전달"], answerText: "잠금 없이 시안을 만들고, 검토 때 정해 주세요." },
    ],
    impact: { taskTitles: ["가입 화면"], blockedTitles: ["가입 화면"] },
    answerMode: "text",
  },
];

// 작업 패널: 작업 6개(상위 작업 "프로토타입"과 하위 작업 2개 포함). id는 내부 값이며 화면에 키로 보이지 않는다.
const work: VmWork = {
  items: [
    {
      id: "design", title: "흐름 초안", ownerId: "designer", ownerKind: "human", status: "done", priority: "normal", childIds: [],
      routingNote: "디자인 판단이 필요해 디자이너에게 맡겼어요", handoffConditions: ["가입 정상 흐름과 오류 흐름이 모두 있음"],
    },
    {
      id: "prototype", title: "프로토타입", ownerId: "prototype-agent", ownerKind: "agent", status: "in_progress", priority: "high", childIds: ["prototype-signup", "prototype-payment"],
      routingNote: "Agent가 할 수 있는 일이라 바로 맡겼어요",
      brief: {
        // 장면의 초기 계획 작업처럼 목표 문단 전체가 맥락으로 오는 경우: 화면은 앞부분만 보이고 나머지는 접는다.
        why: "2주 안에 고객 반응을 보려면 실제로 눌러 볼 수 있는 화면이 필요해요. 대상은 한국의 소규모 제품팀이에요. 가입, 시간 선택, 예약 확인까지 눌러 볼 수 있어야 하고, 결제는 이번 범위에서 빼기로 했어요. 고객 인터뷰 5건에서 반응을 모으고, 디자이너 검토를 거쳐 다음 단계를 정해요.",
        sources: [{ messageId: "m2", excerpt: "2주 안에 고객 반응을 확인하고 싶어요." }],
        decisions: [{ id: "d1", summary: "흐름 초안 기준으로 먼저 진행" }],
        attachments: [{ id: "a2", name: "flow-v2.md", url: "#flow-v2.md" }],
        constraints: ["실제 결제 연동은 하지 않음"],
      },
      origin: { createdByName: "사용자", messageIds: ["m2"] },
    },
    {
      id: "prototype-signup", parentId: "prototype", title: "가입 화면", ownerId: "prototype-agent", ownerKind: "agent", status: "waiting_human", priority: "high", childIds: [],
      waitingOn: { memberId: "owner", requestId: "decision-retry" }, routingNote: "Agent가 할 수 있는 일이라 바로 맡겼어요",
      brief: {
        why: "고객이 처음 만나는 가입 흐름을 프로토타입으로 보여 주기 위해서예요.",
        sources: [{ messageId: "m5", excerpt: "오류 흐름도 보완했어요." }], decisions: [],
        attachments: [{ id: "a2", name: "flow-v2.md", url: "#flow-v2.md" }], constraints: ["오류 흐름 포함"],
      },
      origin: { createdByName: "PM", messageIds: ["m5"] },
      handoffConditions: ["정상·오류 흐름 화면이 모두 있음"], exclusions: [], limits: [],
    },
    {
      id: "prototype-payment", parentId: "prototype", title: "결제 화면", ownerId: "prototype-agent", ownerKind: "agent", status: "waiting_human", priority: "normal", childIds: [],
      waitingOn: { memberId: "owner", requestId: "decision-payment" }, routingNote: "Agent가 할 수 있는 일이라 바로 맡겼어요",
      handoffConditions: ["결제 확인 화면이 있음"],
    },
    {
      id: "review", title: "사용자 검토", ownerId: "reviewer", ownerKind: "human", status: "todo", priority: "normal", childIds: [],
      routingNote: "고객을 직접 만나야 해서 검토자에게 맡겼어요", handoffConditions: ["고객 5명 이상 반응 기록"],
    },
    {
      id: "detail", title: "상세 설계", ownerId: "designer", ownerKind: "human", status: "blocked", priority: "low", childIds: [],
      routingNote: "디자인 판단이 필요해 디자이너에게 맡겼어요",
    },
  ],
  team: [
    { memberId: "owner", state: "결정 2건 대기", openDecisions: 2 },
    { memberId: "designer", currentItemId: "detail", state: "막힘: 이번 주 가용 시간 부족", openDecisions: 0 },
    { memberId: "reviewer", currentItemId: "review", state: "할 일", openDecisions: 0 },
    { memberId: "prototype-agent", currentItemId: "prototype-signup", state: "사용자 결정 대기", openDecisions: 0 },
    { memberId: "research-agent", state: "쉬는 중", openDecisions: 0 },
  ],
};

/** 작업 상세(`GET /api/tasks/:id`) 목업. 없는 id면 undefined. */
export function mockTaskDetail(id: string): VmTaskDetail | undefined {
  const item = work.items.find(i => i.id === id);
  if (!item) return undefined;
  const requested = item.waitingOn ? [{ at: "2026-09-30T01:06:00Z", kind: "decision_requested" as const, actorId: "pm", text: "사용자에게 결정을 요청했어요" }] : [];
  return {
    item,
    activity: [
      { at: "2026-09-29T05:45:00Z", kind: "created", actorId: "pm", text: "PM이 대화에서 작업을 만들었어요", ...(item.origin ? { messageId: item.origin.messageIds[0] } : {}) },
      { at: "2026-09-29T05:46:00Z", kind: "assigned", actorId: "pm", text: item.routingNote ?? "담당을 정했어요" },
      ...requested,
    ],
    comments: [
      { id: `c-${id}`, authorId: "designer", kind: "human", text: "오류 문구는 flow-v2.md 기준으로 맞춰 주세요.", at: "2026-09-29T06:10:00Z", threadId: `task:${id}`, attachments: [] },
    ],
  };
}

const roadmap: VmRoadmap = {
  planVersion: 1,
  tasks: [
    { id: "design", title: "흐름 초안", assigneeName: "디자이너", status: "checked", startDay: 0, endDayMin: 2, endDayMax: 2, hours: { min: 6, max: 10 }, handoffConditions: ["가입 정상 흐름과 오류 흐름이 모두 있음"] },
    { id: "prototype", title: "프로토타입", assigneeName: "프로토타입 Agent", status: "running", startDay: 2, endDayMin: 4.859469270833335, endDayMax: 8.2 },
    { id: "review", title: "사용자 검토", assigneeName: "검토자", status: "waiting", startDay: 8.2, endDayMin: 10, endDayMax: 12 },
    { id: "detail", title: "상세 설계", assigneeName: "디자이너", status: "blocked", startDay: 3, endDayMin: 12, endDayMax: 17 },
  ],
  origin: "2026-09-30T00:00:00Z",
  blocked: [{ taskId: "detail", reason: "디자이너 이번 주 가용 시간 10→5시간", unblockByName: "사용자" }],
  forecast: {
    ok: true, finishMin: "2026-10-10T00:00:00Z", finishMax: "2026-10-15T00:00:00Z", deadline: "2026-10-12T00:00:00Z", lateDaysMax: 2.859469270833335,
    shortage: [{ memberName: "디자이너", hours: 2.5387443452380962 }],
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

// 시나리오가 사용자 작업 시작을 기다리다 멈춘 상태(계약 2의 stalled).
export const mockActivity: VmActivity = {
  kind: "scenario_waiting", label: "대본: 사용자 작업 시작을 기다리는 중", since: "2026-09-30T01:04:30Z",
  stalled: { reason: "사용자 인터뷰 작업이 예약되지 않아 대본을 이어 갈 수 없어요.", canRetry: true, canSkip: true },
};

export function buildMockViewModel(me: string): ViewModel {
  return {
    mode: "scenario",
    project: { goal: "시연용 가상 자료입니다. 2주 안에 고객 반응 확인", deadline: "2026-10-12T00:00:00Z", title: "2주 안에 고객 반응 확인", synthetic: true },
    me,
    members: mockMembers,
    messages,
    cards: allCards.filter(c => c.forMemberId === me),
    decisionCards: decisionCards.filter(c => c.forMemberId === me),
    work,
    roadmap,
    pmLog,
    scenario: {
      name: "scene-1-3",
      nextLine: { authorName: "디자이너", text: "초안으로 먼저 가주세요. 결제 쪽은 아직 애매해서 빼면 좋겠어요.", hasAttachment: false },
      done: false,
    },
    busy: true,
    activity: mockActivity,
  };
}
