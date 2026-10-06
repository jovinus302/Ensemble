// 작업 흐름 C: 상태 색 칩과 PM 단계 칩. 색은 data-tone으로만 정한다(pages-preview.css).
import type { ToneText } from "./card-view";

export function ToneChip({ value, title }: { value: ToneText; title?: string }) {
  return <span className="ctx-chip" data-tone={value.tone} title={title}>{value.text}</span>;
}

/** PM 단계 칩: "판단 중 · 결정 근거 확인 → 멤버 역량 확인 → 가능 인력 검색". 결과가 붙어 있으면 끝난 단계로(✓) 보인다. */
export function StepStrip({ label, steps, done }: { label: string; steps: string[]; done: boolean }) {
  return (
    <div className="ctx-steps" data-done={done || undefined}>
      <span className="ctx-steps-label">{!done && <span className="ctx-spin" aria-hidden />}{label}</span>
      <ol className="ctx-steps-list" aria-label={`${label} 단계`}>
        {steps.map(step => <li key={step}>{done && <span aria-hidden>✓ </span>}{step}</li>)}
      </ol>
    </div>
  );
}
