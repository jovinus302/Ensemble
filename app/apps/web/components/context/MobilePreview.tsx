// 작업 흐름 C 소유: 모바일 앱 화면을 AppPreviewSpec 데이터로 다시 그린다(이미지·내장 글꼴 없음).
// 화면에 나오는 앱 문구는 모두 spec에서 온다. 바뀐 버전(포맷 하나가 빠짐, 라벨이 붙음)은 데이터만으로 달라 보인다.
import type { VmAppPreview } from "../../lib/work-context-view-model";

export function MobilePreview({ preview, compact = false }: { preview: VmAppPreview; compact?: boolean }) {
  const { spec } = preview;
  const [activeTab] = spec.tabs;
  return (
    <figure className="phone-wrap" data-source={preview.source} data-compact={compact || undefined}>
      <figcaption className="phone-label">
        <strong>{preview.label}</strong>
        {preview.caption && <span className="phone-caption">{preview.caption}</span>}
      </figcaption>
      <div className="phone">
        <div className="phone-status" aria-hidden><span /><span /></div>
        <div className="phone-screen">
          <header className="phone-app-head">
            <strong className="phone-app-name">{spec.appName}</strong>
            <span className="phone-date">{spec.dateLabel}</span>
            <span className="phone-versions">
              {spec.versions.map(v => <span key={v} className="phone-version" data-active={v === spec.activeVersion || undefined}>{v}</span>)}
            </span>
          </header>
          <section className="phone-card">
            <h4 className="phone-kicker">{spec.hero.kicker}</h4>
            <div className="phone-hero">
              <span className="phone-badges">
                <span className="phone-badge">{spec.hero.format}</span>
                {spec.hero.badge && <span className="phone-badge" data-tone={spec.hero.badge.tone}>{spec.hero.badge.text}</span>}
              </span>
              <strong className="phone-hero-title">{spec.hero.title}</strong>
              <span className="phone-hero-meta">{spec.hero.meta}</span>
            </div>
            <p className="phone-sources">{spec.hero.sources}</p>
          </section>
          {spec.notice && <section className="phone-card phone-notice" data-tone={spec.notice.tone}>{spec.notice.text}</section>}
          <section className="phone-card">
            <h4 className="phone-kicker">{spec.primaryAction}</h4>
            <div className="phone-make">
              <ul className="phone-formats">{spec.formats.map(f => <li key={f}>{f}</li>)}</ul>
              <span className="phone-make-btn">{spec.formatAction}</span>
            </div>
          </section>
          {spec.history.length > 0 && (
            <section className="phone-card">
              <ul className="phone-history">
                {spec.history.map(h => (
                  <li key={h.date + h.title}><span className="phone-history-date">{h.date}</span><span className="phone-history-title">{h.title}</span><em>{h.format}</em></li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <nav className="phone-tabs" aria-hidden>{spec.tabs.map(t => <span key={t} data-active={t === activeTab || undefined}>{t}</span>)}</nav>
      </div>
      {spec.annotations && spec.annotations.length > 0 && (
        <ul className="phone-annotations">{spec.annotations.map(a => <li key={a.text} data-tone={a.tone}>{a.text}</li>)}</ul>
      )}
    </figure>
  );
}
