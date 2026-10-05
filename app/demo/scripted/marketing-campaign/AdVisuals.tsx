'use client';

import type { ReactNode } from 'react';
import type { ArtifactSection, ContextNode } from '.';
import { Img, ImgFallback, isShortSection, nodeById, parseAdCopy, parseShortOpening, useS27 } from './shared';

/** Phone-feed ad mockup: 4:5 visual with the copy overlaid in HTML. Generic sponsored label, no platform branding. */
export function AdCard({ section, version, copy, className }: {
  section: ArtifactSection;
  version?: string;
  /** Replaces the parsed headline/body block, e.g. for the before/after highlight. */
  copy?: ReactNode;
  className?: string;
}) {
  const ad = parseAdCopy(section.body);
  const alt = `${section.label} 광고 이미지`;
  return (
    <figure className={`s27-ad${className ? ` ${className}` : ''}`}>
      <div className="s27-ad-top">
        <span className="s27-ad-brand" aria-hidden="true">S27</span>
        <span className="s27-ad-sponsor">광고 · S27</span>
        {version && <span className="s27-version">{version}</span>}
      </div>
      <div className="s27-ad-media">
        <Img src={section.image} alt={alt} width={400} height={500} className="s27-ad-img" fallback={<ImgFallback label={alt} className="s27-ad-img" />} />
        <figcaption className="s27-ad-copy">
          {copy ?? (
            <>
              <strong className="s27-ad-headline">{ad.headline}</strong>
              {ad.body && <span className="s27-ad-body">{ad.body}</span>}
              {ad.footnotes.length > 0 && <span className="s27-ad-foot">{ad.footnotes.join(' ')}</span>}
            </>
          )}
        </figcaption>
      </div>
      <div className="s27-ad-label">{section.label}</div>
    </figure>
  );
}

/** First frame of the short-form script as a 9:16 thumbnail. */
export function ShortCard({ section, version, className }: { section: ArtifactSection; version?: string; className?: string }) {
  const opening = parseShortOpening(section.body);
  const alt = `${section.label} 첫 장면${opening.scene ? `: ${opening.scene}` : ''}`;
  return (
    <figure className={`s27-short${className ? ` ${className}` : ''}`}>
      <div className="s27-short-media">
        <Img src={section.image} alt={alt} width={360} height={640} className="s27-short-img" fallback={<ImgFallback label={alt} className="s27-short-img" />} />
        <span className="s27-short-play" aria-hidden="true">▶</span>
        {version && <span className="s27-version s27-short-version">{version}</span>}
        {opening.subtitle && <figcaption className="s27-short-sub">{opening.subtitle}</figcaption>}
      </div>
      <div className="s27-ad-label">{section.label}</div>
    </figure>
  );
}

export function SectionVisual({ section, version }: { section: ArtifactSection; version?: string }) {
  return isShortSection(section) ? <ShortCard section={section} version={version} /> : <AdCard section={section} version={version} />;
}

/** Messenger attachment: the artifact's ads and short as a scrollable visual strip. */
export function ArtifactCarousel({ artifact, compact }: { artifact: ContextNode; compact?: boolean }) {
  const { dispatch, openNode } = useS27();
  const prev = artifact.supersedes ? nodeById.get(artifact.supersedes) : undefined;
  const sections = artifact.sections ?? [];
  const open = () => { openNode(artifact.id); dispatch({ type: 'view_artifact', id: artifact.id }); };
  return (
    <div className={`s27-attach${compact ? ' is-compact' : ''}`}>
      <div className="s27-attach-head">
        <span className="s27-attach-title">{artifact.title.replace(artifact.version ?? '', '').trim()}</span>
        {artifact.version && <span className="s27-version">{artifact.version}</span>}
        {prev?.version && <span className="s27-attach-meta">{prev.version} 수정본</span>}
        {!compact && artifact.changes && artifact.changes.length > 0 && (
          <ul className="s27-change-tags" aria-label="변경점">
            {artifact.changes.slice(0, 3).map((c) => <li key={c}>{c}</li>)}
            {artifact.changes.length > 3 && <li>+{artifact.changes.length - 3}</li>}
          </ul>
        )}
        <button type="button" className="s27-btn s27-btn-tonal s27-btn-sm" onClick={open}>근거 보기 →</button>
      </div>
      <ul className="s27-attach-strip" aria-label={`${artifact.title} 미리보기`}>
        {sections.map((s) => <li key={s.label}><SectionVisual section={s} /></li>)}
      </ul>
    </div>
  );
}
