import { describe, expect, it } from "vitest";
import { continueInstructions, parseReports, taskInstructions, updateInstructions, validateAck, validateResult } from "../src/protocol.ts";
import type { AcknowledgeUpdate, ResultReport } from "../src/protocol.ts";

const fence = (body: string, lang = "ensemble-report") => ["```" + lang, body, "```"].join("\n");

describe("taskInstructions", () => {
  const text = taskInstructions({
    taskId: "T1",
    planVersion: 2,
    goalSummary: { text: "출시용 제품 소개서", sourceId: "msg-1" },
    taskTitle: { text: "기능 섹션 작성", sourceId: "plan-2" },
    handoffConditions: [{ text: "기능 3개 이상", sourceId: "msg-2" }],
    decisions: [{ text: "결제 섹션 제외", sourceId: "dec-1" }],
    inputs: [{ text: "features.md", sourceId: "file-1" }],
    openQuestions: [],
  });

  it("fills the six context slots with their sources", () => {
    for (const heading of ["목표 요약", "담당 작업", "인계 조건", "확정 결정·제외 범위", "입력 자료", "열린 질문"]) expect(text).toContain(heading);
    for (const source of ["[출처: msg-1]", "[출처: plan-2]", "[출처: msg-2]", "[출처: dec-1]", "[출처: file-1]"]) expect(text).toContain(source);
    expect(text).toContain("작업 ID: T1 · 계획 버전: 2");
  });

  it("asks for step-by-step work inside the work folder and the report formats", () => {
    for (const step of ["1. 자료 확인", "2. 구성", "3. 작성", "4. 보고"]) expect(text).toContain(step);
    expect(text).toContain("병렬로 만들지 마세요");
    expect(text).toContain("작업 폴더 안에만");
    expect(text).toContain("```ensemble-report");
    expect(text).toContain('"type": "result_report"');
    expect(text).toContain('"type": "question"');
  });
});

describe("updateInstructions", () => {
  it("demands an acknowledgement before the next step and dropping made outputs", () => {
    const text = updateInstructions({ updateId: "U1", fromVersion: 2, toVersion: 3, keep: ["기능 섹션"], change: ["톤을 간결하게"], drop: ["결제 섹션"], reason: "결제는 다음 분기" });
    expect(text).toContain("버전 2 → 3");
    expect(text).toContain("acknowledge_update 블록을 먼저");
    expect(text).toContain("- 결제 섹션");
    expect(text).toContain("files에서 빼세요");
    expect(text).toContain("drop 목록의 항목 문자열을 그대로 dropped에 먼저 적고");
    expect(text).toContain('"updateId": "U1"');
    expect(text).toContain('"planVersion": 3');
  });
});

describe("parseReports", () => {
  it("parses several valid blocks and ignores other code blocks", () => {
    const text = [
      "진행 상황입니다.",
      fence(JSON.stringify({ type: "acknowledge_update", updateId: "U1", planVersion: 3, applied: ["톤"], dropped: ["결제 섹션"] })),
      fence('{ "type": "question", "taskId": "T1" }', "json"),
      fence("console.log(1)", "ts"),
      fence(JSON.stringify({ type: "question", taskId: "T1", question: "색상은?", options: ["파랑", "빨강"] })),
      fence(JSON.stringify({ type: "result_report", taskId: "T1", planVersion: 3, summary: "완료", files: [{ path: "features.md", description: "기능" }] })),
    ].join("\r\n");
    const { reports, errors } = parseReports(text);
    expect(errors).toEqual([]);
    expect(reports.map((report) => report.type)).toEqual(["acknowledge_update", "question", "result_report"]);
    expect(reports[1]).toEqual({ type: "question", taskId: "T1", question: "색상은?", options: ["파랑", "빨강"] });
  });

  it("collects broken JSON, missing fields and unknown types as errors without throwing", () => {
    const text = [
      fence('{ "type": "result_report", '),
      fence(JSON.stringify({ type: "result_report", taskId: "T1", planVersion: "3", summary: "완료" })),
      fence(JSON.stringify({ type: "acknowledge_update", updateId: "U1", planVersion: 3, applied: [] })),
      fence(JSON.stringify({ type: "shout" })),
      fence("[1, 2]"),
      "```ensemble-report",
      '{ "type": "question"',
    ].join("\n");
    const { reports, errors } = parseReports(text);
    expect(reports).toEqual([]);
    expect(errors).toHaveLength(6);
    expect(errors[0]!.reason).toMatch(/JSON 파싱 실패/);
    expect(errors[1]!.reason).toMatch(/planVersion.*files/);
    expect(errors[2]!.reason).toMatch(/dropped/);
    expect(errors[3]!.reason).toMatch(/알 수 없는 보고 타입/);
    expect(errors[4]!.reason).toMatch(/객체가 아님/);
    expect(errors[5]!.reason).toMatch(/닫히지 않음/);
  });

  it("returns nothing for text without report blocks", () => {
    expect(parseReports("그냥 메시지")).toEqual({ reports: [], errors: [] });
  });
});

describe("validateAck", () => {
  const expected = { updateId: "U1", planVersion: 3, drop: ["결제 섹션"] };
  const ack: AcknowledgeUpdate = { type: "acknowledge_update", updateId: "U1", planVersion: 3, applied: ["톤"], dropped: ["결제 섹션", "sections/결제.md"] };

  it("accepts a matching acknowledgement", () => expect(validateAck(ack, expected)).toEqual({ ok: true }));

  it("rejects a mismatched updateId", () => {
    const result = validateAck({ ...ack, updateId: "U0" }, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toEqual(["updateId 불일치: U0 (기대: U1)"]);
  });

  it("rejects an acknowledgement that leaves out a dropped item", () => {
    const result = validateAck({ ...ack, dropped: [] }, expected);
    expect(result).toEqual({ ok: false, reasons: ["폐기 항목 누락: 결제 섹션"] });
  });
});

describe("validateResult", () => {
  const expected = { taskId: "T1", planVersion: 3, dropped: ["결제 섹션", "sections/payment.md"] };
  const report: ResultReport = { type: "result_report", taskId: "T1", planVersion: 3, summary: "완료", files: [{ path: "sections/features.md", description: "기능" }] };

  it("accepts a result on the current plan without dropped files", () => expect(validateResult(report, expected)).toEqual({ ok: true }));

  it("rejects a result reported against an old plan version", () => {
    expect(validateResult({ ...report, planVersion: 2 }, expected)).toEqual({ ok: false, reasons: ["planVersion 불일치: 2 (기대: 3)"] });
  });

  it("rejects a result that still lists the dropped payment file", () => {
    const stale = { ...report, files: [...report.files, { path: "./sections\\payment.md", description: "결제 섹션" }] };
    const result = validateResult(stale, expected);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toEqual(["폐기된 항목이 files에 남아 있음: ./sections\\payment.md (폐기: sections/payment.md)"]);
  });

  it("matches a dropped item by name without extension", () => {
    const result = validateResult({ ...report, files: [{ path: "out/결제.md", description: "결제" }] }, { ...expected, dropped: ["결제"] });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty file list and a wrong task", () => {
    const result = validateResult({ ...report, taskId: "T2", files: [] }, expected);
    expect(result).toEqual({ ok: false, reasons: ["taskId 불일치: T2 (기대: T1)", "files가 비어 있음"] });
  });
});

describe("scope cuts (M11 T2)", () => {
  const task = {
    taskId: "prototype", planVersion: 3,
    goalSummary: { text: "요가 예약 프로토타입", sourceId: "goal" },
    taskTitle: { text: "예약 프로토타입 (결제 제외, 가입·시간 선택·예약 확인까지)", sourceId: "plan-3" },
    handoffConditions: [{ text: "가입·시간 선택·예약 확인·결제 화면으로 이동 가능", sourceId: "plan-3:h0" }, { text: "실제 개인정보 저장 금지", sourceId: "plan-3:h1" }],
    exclusions: [{ text: "결제 화면과 모의 결제 버튼", sourceId: "plan-3:x0" }],
    limits: [{ text: "가입·시간 선택·예약 확인까지", sourceId: "plan-3:l0" }],
    decisions: [], inputs: [], openQuestions: [],
  };
  const update = { updateId: "revision:r1:reopen", fromVersion: 3, toVersion: 3, keep: [], change: ["사용자 요청: 캘린더에 추가 버튼"], drop: [], reason: "확인된 결과에 사용자가 보완을 요청했습니다" };

  it("lists the exclusions and limits apart from the unchanged conditions, and keeps prohibitions", () => {
    const text = taskInstructions(task);
    expect(text).toContain("## 3. 인계 조건\n- 가입·시간 선택·예약 확인·결제 화면으로 이동 가능 [출처: plan-3:h0]\n- 실제 개인정보 저장 금지 [출처: plan-3:h1]\n## 범위 제외·한정 (사람이 정한 범위)");
    expect(text).toContain("제외 범위 — 만들지 않습니다:\n- 결제 화면과 모의 결제 버튼 [출처: plan-3:x0]");
    expect(text).toContain("한정 범위 — 여기까지만 만듭니다:\n- 가입·시간 선택·예약 확인까지 [출처: plan-3:l0]");
    expect(text).toContain("금지 제약은 범위와 관계없이 그대로 지킵니다");
    expect(taskInstructions({ ...task, exclusions: [], limits: [] })).not.toContain("범위 제외·한정");
  });

  it("repeats the scope cut in a follow-up turn on a thread that already has the task", () => {
    const text = continueInstructions({ taskId: "prototype", planVersion: 3, update, task }, false);
    expect(text).not.toContain("# 작업 지시");
    expect(text).toContain("- 사용자 요청: 캘린더에 추가 버튼");
    expect(text).toContain("제외 범위 — 만들지 않습니다:\n- 결제 화면과 모의 결제 버튼");
    expect(text.indexOf("범위 제외·한정")).toBeLessThan(text.indexOf("## 이어서 할 일"));
    // With the full task the section appears once, inside the instructions.
    const full = continueInstructions({ taskId: "prototype", planVersion: 3, update, task }, true);
    expect(full.split("## 범위 제외·한정").length).toBe(2);
  });
});
