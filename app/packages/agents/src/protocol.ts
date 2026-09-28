// Execution-agent reporting protocol. An agent (a Codex session) never calls app tools directly;
// it writes fenced `ensemble-report` blocks in its messages and the app parses and checks them.
// Everything here is pure: builds instructions, parses reports, validates them against the plan.

export const REPORT_FENCE = "ensemble-report";

/** A context item and the ledger/message ID it came from, so the agent can cite it back. */
export interface SourcedItem {
  text: string;
  sourceId: string;
}

export interface TaskInstructionsInput {
  taskId: string;
  planVersion: number;
  /** The six context slots. */
  goalSummary: SourcedItem;
  taskTitle: SourcedItem;
  handoffConditions: SourcedItem[];
  /** Confirmed decisions and explicit exclusions. */
  decisions: SourcedItem[];
  inputs: SourcedItem[];
  openQuestions: SourcedItem[];
}

export interface UpdateInstructionsInput {
  updateId: string;
  fromVersion: number;
  toVersion: number;
  keep: string[];
  change: string[];
  drop: string[];
  reason: string;
}

export interface AcknowledgeUpdate {
  type: "acknowledge_update";
  updateId: string;
  planVersion: number;
  applied: string[];
  dropped: string[];
}

export interface ReportedFile {
  /** Relative to the task's work folder. */
  path: string;
  description: string;
}

export interface ResultReport {
  type: "result_report";
  taskId: string;
  planVersion: number;
  summary: string;
  files: ReportedFile[];
  limitations?: string[];
}

export interface QuestionReport {
  type: "question";
  taskId: string;
  question: string;
  options?: string[];
}

export type Report = AcknowledgeUpdate | ResultReport | QuestionReport;

export interface ParseError {
  raw: string;
  reason: string;
}

export type Validation = { ok: true } | { ok: false; reasons: string[] };

const cite = (item: SourcedItem) => `${item.text} [출처: ${item.sourceId}]`;
const list = (items: SourcedItem[]) => (items.length ? items.map((item) => `- ${cite(item)}`).join("\n") : "- 없음");
const plain = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- 없음");
const block = (value: object) => ["```" + REPORT_FENCE, JSON.stringify(value, null, 2), "```"].join("\n");

export function taskInstructions(input: TaskInstructionsInput): string {
  const result = block({ type: "result_report", taskId: input.taskId, planVersion: input.planVersion, summary: "무엇을 만들었는지 한두 문장", files: [{ path: "작업 폴더 기준 상대 경로", description: "이 파일의 내용" }], limitations: ["확인하지 못한 점 (없으면 생략)"] });
  const question = block({ type: "question", taskId: input.taskId, question: "막힌 내용과 필요한 결정", options: ["선택지 A", "선택지 B"] });
  return [
    `# 작업 지시: ${input.taskTitle.text}`,
    `작업 ID: ${input.taskId} · 계획 버전: ${input.planVersion}`,
    "",
    "## 1. 목표 요약",
    `- ${cite(input.goalSummary)}`,
    "## 2. 담당 작업",
    `- ${cite(input.taskTitle)}`,
    "## 3. 인계 조건",
    list(input.handoffConditions),
    "## 4. 확정 결정·제외 범위",
    list(input.decisions),
    "## 5. 입력 자료",
    list(input.inputs),
    "## 6. 열린 질문",
    list(input.openQuestions),
    "",
    "## 작업 방식",
    "다음 단계를 순서대로 하나씩 진행하세요. 앞 단계가 끝나기 전에 다음 단계로 넘어가지 마세요.",
    "1. 자료 확인: 입력 자료와 확정 결정을 읽고 인계 조건을 확인합니다.",
    "2. 구성: 만들 산출물의 목차와 구성을 먼저 정합니다.",
    "3. 작성: 구성한 순서대로 산출물을 하나씩 작성합니다.",
    "4. 보고: 인계 조건을 다시 확인한 뒤 결과를 보고합니다.",
    "",
    "## 지켜야 할 것",
    "- 한 번에 여러 산출물을 병렬로 만들지 마세요. 산출물은 하나씩 완성합니다.",
    "- 파일은 작업 폴더 안에만 만드세요. 작업 폴더 밖의 파일은 만들거나 고치지 마세요.",
    "- 확정 결정·제외 범위에 있는 내용은 바꾸거나 다시 만들지 마세요.",
    "",
    "## 보고 형식",
    "작업이 끝나면 아래 형식의 result_report 블록을 정확히 하나 쓰세요. files의 path는 작업 폴더 기준 상대 경로입니다.",
    result,
    "막혀서 진행할 수 없으면 추측하지 말고 아래 형식의 question 블록을 쓰고 멈추세요.",
    question,
  ].join("\n");
}

export function updateInstructions(input: UpdateInstructionsInput): string {
  const ack = block({ type: "acknowledge_update", updateId: input.updateId, planVersion: input.toVersion, applied: ["반영한 변경"], dropped: ["폐기한 항목과 이미 만든 산출물 경로"] });
  return [
    `# 계획 변경: 버전 ${input.fromVersion} → ${input.toVersion}`,
    `변경 ID: ${input.updateId}`,
    `변경 이유: ${input.reason}`,
    "",
    "## 유지",
    plain(input.keep),
    "## 변경",
    plain(input.change),
    "## 폐기",
    plain(input.drop),
    "",
    "## 먼저 할 일",
    "다음 단계로 넘어가기 전에 아래 acknowledge_update 블록을 먼저 쓰세요. 이 확인 없이 작업을 계속하지 마세요.",
    `- planVersion은 ${input.toVersion}으로 씁니다.`,
    "- applied에는 반영한 변경을, dropped에는 폐기 항목을 모두 넣습니다.",
    "- drop 목록의 항목 문자열을 그대로 dropped에 먼저 적고, 이미 만든 산출물 경로는 그 뒤에 추가하세요.",
    "- 폐기 대상으로 이미 만든 산출물이 있으면 그 경로도 dropped에 넣고, 최종 result_report의 files에서 빼세요.",
    ack,
    "",
    `이후 모든 보고는 계획 버전 ${input.toVersion} 기준으로 씁니다.`,
  ].join("\n");
}

type Fields = Record<string, unknown>;
const isString = (value: unknown): value is string => typeof value === "string";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

function checkReport(value: unknown): Report | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "보고가 JSON 객체가 아님";
  const fields = value as Fields;
  const need = (checks: [string, (v: unknown) => boolean, string][]): string | null => {
    const bad = checks.filter(([key, ok]) => !ok(fields[key])).map(([key, , kind]) => `${key}: ${kind} 필요`);
    return bad.length ? `${String(fields.type)} 필드 오류 — ${bad.join(", ")}` : null;
  };
  const optional = (check: (v: unknown) => boolean) => (v: unknown) => v === undefined || check(v);
  switch (fields.type) {
    case "acknowledge_update": {
      const error = need([["updateId", isString, "문자열"], ["planVersion", isVersion, "정수"], ["applied", isStringArray, "문자열 배열"], ["dropped", isStringArray, "문자열 배열"]]);
      if (error) return error;
      return { type: "acknowledge_update", updateId: fields.updateId as string, planVersion: fields.planVersion as number, applied: fields.applied as string[], dropped: fields.dropped as string[] };
    }
    case "result_report": {
      const isFiles = (v: unknown) => Array.isArray(v) && v.every((file) => typeof file === "object" && file !== null && isString((file as Fields).path) && isString((file as Fields).description));
      const error = need([["taskId", isString, "문자열"], ["planVersion", isVersion, "정수"], ["summary", isString, "문자열"], ["files", isFiles, "{path, description} 배열"], ["limitations", optional(isStringArray), "문자열 배열"]]);
      if (error) return error;
      const files = (fields.files as Fields[]).map((file) => ({ path: file.path as string, description: file.description as string }));
      const report: ResultReport = { type: "result_report", taskId: fields.taskId as string, planVersion: fields.planVersion as number, summary: fields.summary as string, files };
      if (fields.limitations !== undefined) report.limitations = fields.limitations as string[];
      return report;
    }
    case "question": {
      const error = need([["taskId", isString, "문자열"], ["question", isString, "문자열"], ["options", optional(isStringArray), "문자열 배열"]]);
      if (error) return error;
      const report: QuestionReport = { type: "question", taskId: fields.taskId as string, question: fields.question as string };
      if (fields.options !== undefined) report.options = fields.options as string[];
      return report;
    }
    default:
      return `알 수 없는 보고 타입: ${JSON.stringify(fields.type)}`;
  }
}

/** Extracts every `ensemble-report` block; malformed ones land in errors instead of throwing. */
export function parseReports(text: string): { reports: Report[]; errors: ParseError[] } {
  const reports: Report[] = [];
  const errors: ParseError[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(`{3,})\s*(\S*)/.exec(lines[i]!);
    if (!open) continue;
    const [, fence, lang] = open as unknown as [string, string, string];
    let end = i + 1;
    while (end < lines.length && !new RegExp(`^\\s*${fence}\`*\\s*$`).test(lines[end]!)) end++;
    const raw = lines.slice(i + 1, end).join("\n");
    if (lang === REPORT_FENCE) {
      if (end >= lines.length) errors.push({ raw, reason: "보고 블록이 닫히지 않음" });
      else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          errors.push({ raw, reason: `JSON 파싱 실패: ${(error as Error).message}` });
          i = end;
          continue;
        }
        const checked = checkReport(parsed);
        if (typeof checked === "string") errors.push({ raw, reason: checked });
        else reports.push(checked);
      }
    }
    i = end;
  }
  return { reports, errors };
}

const verdict = (reasons: string[]): Validation => (reasons.length ? { ok: false, reasons } : { ok: true });

export function validateAck(ack: AcknowledgeUpdate, expected: { updateId: string; planVersion: number; drop: string[] }): Validation {
  const reasons: string[] = [];
  if (ack.updateId !== expected.updateId) reasons.push(`updateId 불일치: ${ack.updateId} (기대: ${expected.updateId})`);
  if (ack.planVersion !== expected.planVersion) reasons.push(`planVersion 불일치: ${ack.planVersion} (기대: ${expected.planVersion})`);
  for (const item of expected.drop) {
    if (!ack.dropped.some((dropped) => matchesDropped(dropped, item))) reasons.push(`폐기 항목 누락: ${item}`);
  }
  return verdict(reasons);
}

export function validateResult(report: ResultReport, expected: { taskId: string; planVersion: number; dropped: string[] }): Validation {
  const reasons: string[] = [];
  if (report.taskId !== expected.taskId) reasons.push(`taskId 불일치: ${report.taskId} (기대: ${expected.taskId})`);
  if (report.planVersion !== expected.planVersion) reasons.push(`planVersion 불일치: ${report.planVersion} (기대: ${expected.planVersion})`);
  if (report.files.length === 0) reasons.push("files가 비어 있음");
  for (const file of report.files) {
    const hit = expected.dropped.find((item) => matchesDropped(file.path, item));
    if (hit !== undefined) reasons.push(`폐기된 항목이 files에 남아 있음: ${file.path} (폐기: ${hit})`);
  }
  return verdict(reasons);
}

const normalizePath = (value: string) => value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").toLowerCase();
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const stem = (name: string) => (name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name);

/** A path matches a dropped item by full path, file name, or file name without extension. */
function matchesDropped(path: string, item: string): boolean {
  const a = normalizePath(path);
  const b = normalizePath(item);
  if (!a || !b) return false;
  if (a === b) return true;
  const nameA = baseName(a);
  const nameB = baseName(b);
  return nameA === nameB || stem(nameA) === stem(nameB);
}
