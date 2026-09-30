/** Keep provider/internal text in server logs; expose only known, translated validation rules. */
export function draftFailureDetail(detail: string): string {
  const rules: [RegExp, string][] = [
    [/Invalid plan draft/, '계획 응답 형식 또는 작업 수가 역할 템플릿과 다릅니다'],
    [/Invalid template key or title/, '작업 역할이나 제목이 올바르지 않습니다'],
    [/Fields outside/, '역할 템플릿에서 허용하지 않은 항목이 있습니다'],
    [/assignee|template role/i, '담당자 또는 역할 구성이 올바르지 않습니다'],
    [/handoff condition/i, '인계 조건은 결과물 내용으로 확인 가능해야 합니다'],
    [/Invalid estimate/, '예상 시간은 0 이상이며 최대값이 최소값 이상이어야 합니다'],
    [/Duplicate or missing task/, '작업이 중복되었거나 빠졌습니다'],
    [/Cyclic dependencies/, '작업 의존 관계가 순환합니다'],
    [/Dependency absent/, '선행 작업이 계획에 없습니다'],
    [/token|cut off/i, '모델 응답이 길이 제한으로 잘렸습니다'],
    [/Model call failed/i, '계획 모델 호출에 실패했습니다'],
  ];
  return rules.find(([pattern]) => pattern.test(detail))?.[1] ?? '계획 응답을 해석하지 못했습니다. 서버 기록에서 세부 원인을 확인해 주세요';
}

export class ScenarioError extends Error {}
