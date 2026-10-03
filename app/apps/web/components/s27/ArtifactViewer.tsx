'use client';

import type { ArtifactSection, ContextNode } from '../../lib/s27';
import { NodeChip, nodeById, useS27 } from './shared';

type DiffOp = { op: 'same' | 'add' | 'del'; text: string };

/** Line-level LCS diff; sections are a few lines long. */
function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ op: 'same', text: a[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ op: 'del', text: a[i]! }); i++; }
    else { out.push({ op: 'add', text: b[j]! }); j++; }
  }
  while (i < a.length) out.push({ op: 'del', text: a[i++]! });
  while (j < b.length) out.push({ op: 'add', text: b[j++]! });
  return out;
}

export function ArtifactViewer({ artifact, versions }: { artifact: ContextNode; versions: ContextNode[] }) {
  const { dispatch } = useS27();
  const prev = artifact.supersedes ? nodeById.get(artifact.supersedes) : undefined;
  const prevSections = new Map<string, ArtifactSection>((prev?.sections ?? []).map((s) => [s.label, s]));

  return (
    <div className="s27-card s27-artifact-viewer">
      <div className="s27-card-label">결과물 뷰어</div>
      <div className="s27-viewer-head">
        <h3 className="s27-inspector-title">{artifact.title}</h3>
        {versions.length > 0 && (
          <div className="s27-versions" role="group" aria-label="버전 선택">
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`s27-version-btn${v.id === artifact.id ? ' is-active' : ''}`}
                aria-pressed={v.id === artifact.id}
                onClick={() => dispatch({ type: 'view_artifact', id: v.id })}
              >
                {v.version ?? v.id}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="s27-muted s27-small">{artifact.place} · {artifact.at}{prev ? ` · ${prev.version ?? prev.title}을(를) 이어받은 수정본` : ''}</p>

      {prev && artifact.changes && artifact.changes.length > 0 && (
        <div className="s27-changes">
          <div className="s27-trace-head">{prev.version ?? '이전 버전'} → {artifact.version} 변경점</div>
          <ul>{artifact.changes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}

      <div className="s27-sections">
        {(artifact.sections ?? []).map((s) => {
          const before = prev ? prevSections.get(s.label) : undefined;
          const changed = prev && (!before || before.body !== s.body);
          return (
            <article key={s.label} className={`s27-section${changed ? ' is-changed' : ''}`}>
              <header className="s27-section-head">
                <h4>{s.label}</h4>
                {prev && <span className={`s27-diff-tag${changed ? ' is-changed' : ''}`}>{!before ? '새 섹션' : changed ? '수정됨' : '변경 없음'}</span>}
              </header>
              {changed && before ? (
                <div className="s27-diff" aria-label={`${s.label} 변경 전후`}>
                  {diffLines(before.body, s.body).map((d, k) => (
                    <div key={k} className={`s27-diff-line is-${d.op}`}>
                      <span className="s27-diff-sign" aria-hidden="true">{d.op === 'add' ? '+' : d.op === 'del' ? '−' : ' '}</span>
                      {d.op === 'add' && <span className="s27-sr">추가: </span>}
                      {d.op === 'del' && <span className="s27-sr">삭제: </span>}
                      {d.op === 'del' ? <del>{d.text || ' '}</del> : d.op === 'add' ? <ins>{d.text || ' '}</ins> : <span>{d.text || ' '}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="s27-section-body">{s.body}</p>
              )}
              {s.grounds.length > 0 && (
                <div className="s27-grounds">
                  <span className="s27-grounds-label">근거</span>
                  <div className="s27-chips">{s.grounds.map((g) => <NodeChip key={g} id={g} />)}</div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
