'use client';

import type { ArtifactSection, ContextNode } from '../../lib/s27';
import { AdCard, SectionVisual, ShortCard } from './AdVisuals';
import { RefChips, isShortSection, nodeById, nodeShort, parseAdCopy, useS27 } from './shared';

/** Image-first artifact view. A revision shows a visual before/after; the full copy sits behind a disclosure. */
export function ArtifactViewer({ artifact, versions }: { artifact: ContextNode; versions: ContextNode[] }) {
  const { dispatch } = useS27();
  const prev = artifact.supersedes ? nodeById.get(artifact.supersedes) : undefined;
  const sections = artifact.sections ?? [];

  return (
    <div className="s27-viewer">
      <header className="s27-viewer-head">
        <span className="s27-kind-tag s27-kind-artifact">결과물</span>
        <h3 className="s27-viewer-title">{nodeShort(artifact)}</h3>
        {versions.length > 1 && (
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
        {prev && artifact.changes && artifact.changes.length > 0 && (
          <ul className="s27-change-tags" aria-label={`${prev.version ?? '이전 버전'} 대비 변경점`}>
            {artifact.changes.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
      </header>

      {prev ? <BeforeAfter prev={prev} artifact={artifact} /> : (
        <ul className="s27-ad-grid" aria-label={`${artifact.title} 소재`}>
          {sections.map((s) => <li key={s.label}><SectionVisual section={s} /></li>)}
        </ul>
      )}

      <details className="s27-fulltext">
        <summary>카피 전체</summary>
        <ul className="s27-fulltext-list">
          {sections.map((s) => (
            <li key={s.label}>
              <h4>{s.label}</h4>
              <p>{s.body}</p>
              <RefChips refs={s.grounds} label={`${s.label} 근거`} />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** The ad section whose copy gained a footnote (the legal fix), else the first changed ad. */
function pickChangedAd(prev: ArtifactSection[], next: ArtifactSection[]) {
  const pairs = next.filter((s) => !isShortSection(s)).flatMap((after) => {
    const before = prev.find((p) => p.label === after.label);
    return before && before.body !== after.body ? [{ before, after }] : [];
  });
  return pairs.find((p) => parseAdCopy(p.after.body).footnotes.length > parseAdCopy(p.before.body).footnotes.length) ?? pairs[0];
}

function BeforeAfter({ prev, artifact }: { prev: ContextNode; artifact: ContextNode }) {
  const before = prev.sections ?? [];
  const after = artifact.sections ?? [];
  const shortBefore = before.find(isShortSection);
  const shortAfter = after.find(isShortSection);
  const ad = pickChangedAd(before, after);
  const a = ad ? parseAdCopy(ad.after.body) : null;
  const b = ad ? parseAdCopy(ad.before.body) : null;
  const addedNotes = a && b ? a.footnotes.filter((f) => !b.footnotes.includes(f)) : [];

  return (
    <div className="s27-ba" aria-label={`${prev.version} → ${artifact.version} 변경 전후`}>
      {shortBefore && shortAfter && (
        <figure className="s27-ba-pair">
          <ShortCard section={shortBefore} version={prev.version} className="is-before" />
          <span className="s27-ba-arrow" aria-hidden="true">→</span>
          <ShortCard section={shortAfter} version={artifact.version} className="is-after" />
          <figcaption className="s27-ba-cap">숏폼 첫 장면</figcaption>
        </figure>
      )}
      {ad && a && b && (
        <figure className="s27-ba-pair">
          <AdCard
            section={ad.after}
            version={artifact.version}
            className="is-after"
            copy={(
              <>
                {b.headline !== a.headline && (
                  <del className="s27-ad-struck"><span className="s27-sr">삭제된 문구: </span>{b.headline}</del>
                )}
                <strong className="s27-ad-headline"><mark>{a.headline}</mark></strong>
                {a.body && <span className="s27-ad-body">{a.body}</span>}
                {addedNotes.map((f) => (
                  <ins key={f} className="s27-ad-foot is-added"><span className="s27-sr">추가된 각주: </span>{f}</ins>
                ))}
              </>
            )}
          />
          <figcaption className="s27-ba-cap">{ad.after.label} · 법무 의견 반영</figcaption>
        </figure>
      )}
    </div>
  );
}
