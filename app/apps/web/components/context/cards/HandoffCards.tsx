// 작업 흐름 C: 제작 도구 전달·빌드 줄. 진행 라벨은 서버가 지금 상태로 풀어 준 값이라 같은 카드에서 바뀐다.
import type { VmToolHandoff } from "../../../lib/work-context-view-model";
import { handoffRow } from "./card-view";

export function HandoffRows({ handoffs, mode }: { handoffs: VmToolHandoff[]; mode: "handoff" | "build" }) {
  return (
    <ul className="ctx-route ctx-handoffs">
      {handoffs.map(h => {
        const row = handoffRow(h, mode);
        return (
          <li key={h.id} data-tool={h.toolId}>
            <span className="ctx-route-text">
              <strong>{row.lead}</strong> {mode === "build" ? `· ${row.text}` : row.text}
              {row.owner && <em className="ctx-owner"> {row.owner}</em>}
              {row.memo && <span className="ctx-memo">{row.memo}</span>}
            </span>
            <span className="ctx-chip ctx-progress" data-tone={row.status.tone}>
              {row.working && <span className="ctx-spin" aria-hidden />}{row.status.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
