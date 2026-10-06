// 작업 흐름 C 소유: 모바일 앱 화면을 AppPreviewSpec 데이터로 다시 그린다(이미지·내장 글꼴 없음). 기반 커밋은 최소 화면이다.
import type { VmAppPreview } from "../../lib/work-context-view-model";

export function MobilePreview({ preview }: { preview: VmAppPreview }) {
  const { spec } = preview;
  return (
    <figure className="phone" data-source={preview.source}>
      <figcaption className="phone-label">{preview.label}{preview.caption && <span className="muted small"> · {preview.caption}</span>}</figcaption>
      <div className="phone-screen">
        <header className="phone-app-head"><strong>{spec.appName}</strong> <span className="muted small">{spec.dateLabel} · {spec.activeVersion}</span></header>
        <section className="phone-hero">
          <span className="muted small">{spec.hero.kicker}</span>
          <span className="phone-format">{spec.hero.format}{spec.hero.badge && <span className="phone-badge" data-tone={spec.hero.badge.tone}>{spec.hero.badge.text}</span>}</span>
          <strong className="phone-hero-title">{spec.hero.title}</strong>
          <span className="small">{spec.hero.meta}</span>
          <span className="muted small">{spec.hero.sources}</span>
        </section>
        {spec.notice && <p className="phone-notice" data-tone={spec.notice.tone}>{spec.notice.text}</p>}
        <button type="button" className="btn-primary btn-small" tabIndex={-1}>{spec.primaryAction}</button>
        <ul className="phone-formats">{spec.formats.map(f => <li key={f}>{f}</li>)}</ul>
        <ul className="phone-history">{spec.history.map(h => <li key={h.date + h.title}><span className="num">{h.date}</span> {h.title} · {h.format}</li>)}</ul>
        <nav className="phone-tabs">{spec.tabs.map(t => <span key={t}>{t}</span>)}</nav>
      </div>
      {spec.annotations && <ul className="phone-annotations">{spec.annotations.map(a => <li key={a.text} data-tone={a.tone}>{a.text}</li>)}</ul>}
    </figure>
  );
}
