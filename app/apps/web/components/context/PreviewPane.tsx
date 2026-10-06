"use client";
// 작업 흐름 C 소유: 오른쪽 모바일 미리보기(Proposal·분기 비교·예상 화면·빌드).
// 분기 예상("A로 가면?")이 열려 있으면 그 화면과 지금 화면을 나란히 그린다. 좁은 화면에서는 맥락 탭의 캔버스 아래에 온다.
import type { VmWorkContext } from "../../lib/work-context-view-model";
import { MobilePreview } from "./MobilePreview";

export function PreviewPane({ context }: { context: VmWorkContext }) {
  const { preview, comparePreview } = context;
  if (!preview && !comparePreview) return null;
  return (
    <aside className="preview-pane" aria-label="화면 미리보기">
      <h2 className="preview-pane-title">화면 미리보기</h2>
      {comparePreview ? (
        <div className="preview-compare">
          <MobilePreview preview={comparePreview} compact />
          {preview && <MobilePreview preview={preview} compact />}
        </div>
      ) : preview && <MobilePreview preview={preview} />}
    </aside>
  );
}
