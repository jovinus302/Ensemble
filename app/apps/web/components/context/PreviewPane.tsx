"use client";
// 작업 흐름 C 소유: 오른쪽 모바일 미리보기(Proposal·분기 비교·예상 화면·빌드).
import type { VmWorkContext } from "../../lib/work-context-view-model";
import { MobilePreview } from "./MobilePreview";

export function PreviewPane({ context }: { context: VmWorkContext }) {
  if (!context.preview && !context.comparePreview) return null;
  return (
    <aside className="preview-pane" aria-label="화면 미리보기">
      {context.comparePreview && <MobilePreview preview={context.comparePreview} />}
      {context.preview && <MobilePreview preview={context.preview} />}
    </aside>
  );
}
