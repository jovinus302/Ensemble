'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { SOURCES, WORK_SOURCES, ERROR_COPY, codeExample, companion, contextReducer, initialContext, pendingWork, revision, type Workspace, type WorkSource } from './context';
import './workspaces.css';

function LoginPreview({ updated }: { updated: boolean }) {
  return <div className="wd-login" aria-label={`로그인 오류 화면 예시 v${updated ? 2 : 1}`}>
    <span className="wd-wordmark">acme</span><h3>다시 만나 반가워요</h3><p>이메일로 로그인하고 작업을 이어가세요.</p>
    <div className="wd-field"><span>이메일</span><strong>{updated ? 'hello@example.com' : '이메일을 입력하세요'}</strong></div>
    <div className="wd-field"><span>비밀번호</span><strong>{updated ? '••••••••' : '비밀번호를 입력하세요'}</strong></div>
    <p className="wd-error">{updated ? ERROR_COPY : '로그인에 실패했습니다.'}</p>
    <div className="wd-login-button">로그인</div><p className="wd-preview-label">상태: 로그인 실패 · 화면 예시</p>
  </div>;
}

export function WorkspaceDemo() {
  const [state, dispatch] = useReducer(contextReducer, undefined, initialContext);
  const [workspace, setWorkspace] = useState<Workspace>('dev');
  const [contextVisible, setContextVisible] = useState(true);
  const [artifact, setArtifact] = useState<WorkSource | null>(null);
  const [announcement, announce] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = pendingWork(state);
  const linked = WORK_SOURCES.filter(source => state.connected[source]);
  const active = SOURCES[workspace];
  const isWork = workspace === 'dev' || workspace === 'design';
  const updated = isWork && state.revised[workspace];
  const bothLinked = linked.length === 2;

  useEffect(() => { if (artifact && !dialog.current?.open) dialog.current?.showModal(); }, [artifact]);
  function goTo(source: Workspace) {
    setWorkspace(source);
    // The heading stays mounted; keyboard users land at the newly selected source.
    heading.current?.focus();
  }
  function connect() {
    dispatch({ type: 'connect', source: workspace });
    announce(`${active.title}의 ${isWork ? '산출물' : '결정'}을 프로젝트에 연결했습니다.`);
  }
  function revise(source: WorkSource) {
    dispatch({ type: 'revise', source });
    announce(`${SOURCES[source].title} 산출물 v2에 미팅 결정이 반영되었습니다. 최종 검토는 별도입니다.`);
  }
  function reset() {
    dispatch({ type: 'reset' });
    setWorkspace('dev');
    setArtifact(null);
    dialog.current?.close();
    announce('예시를 처음 상태로 되돌렸습니다.');
  }
  const sourceLink = (source: Workspace) => <button className="wd-source-link" onClick={() => goTo(source)}>{SOURCES[source].reference} ↗</button>;

  return <div className="ens-demo">
    <header className="wd-topbar"><a className="wd-brand" href="/demo"><span className="wd-symbol" aria-hidden="true">e</span> ensemble <span className="wd-label">PM AGENT</span></a><div className="wd-top-actions"><button onClick={reset}>처음부터</button><button aria-expanded={contextVisible} aria-controls="project-context" onClick={() => setContextVisible(value => !value)}>{contextVisible ? '보조 뷰 숨기기' : '보조 뷰 보기'}</button></div></header>
    <main className="wd-main">
      <section className="wd-intro"><div><p className="wd-eyebrow">YOUR WORK. CONNECTED.</p><h1>맥락을 이해하고,<br />다음 일을 잇다.</h1><p className="wd-lede">각자의 도구에서 사람과 Agent가 일하는 동안,<br />PM Agent가 결정과 결과를 연결하고 다음 행동을 챙깁니다.</p></div><div className="wd-demo-card"><span className="wd-eyebrow">이번에 살펴볼 협업</span><strong>로그인 경험 개선</strong><span>개발 + 디자인 + 팀의 결정</span><p>다양한 프로젝트에 적용되는<br />PM Agent의 한 가지 사례입니다.</p></div></section>
      <p className="wd-disclosure">인터랙티브 예시 · 실제 도구나 Agent에 연결되지 않습니다. 각 공간의 결과를 공유해 PM Agent의 연결과 후속 조율을 확인하세요.</p>
      <div className={`wd-layout ${contextVisible ? '' : 'wd-context-hidden'}`}>
        <section className="wd-workspace" aria-label="기존 작업 환경">
          <div className="wd-section-heading"><span className="wd-eyebrow">01 / 각자의 작업 공간</span><span>일하는 곳은 그대로</span></div>
          <nav className="wd-tabs" aria-label="작업 공간 선택">{(Object.keys(SOURCES) as Workspace[]).map(source => <button key={source} aria-pressed={workspace === source} onClick={() => goTo(source)}><span aria-hidden="true">{SOURCES[source].icon}</span>{SOURCES[source].title}<small>{SOURCES[source].tool}</small></button>)}</nav>
          <div className={`wd-window wd-${workspace}`}>
            <div className="wd-window-bar"><span><span aria-hidden="true" className="wd-dots">● ● ●</span> {active.tool} · 예시</span><span>login-experience</span></div>
            <div className="wd-work-body">
              <p className="wd-person">{active.person} <span>내 작업 공간</span></p>
              <h2 tabIndex={-1} ref={heading} className="wd-work-title">{workspace === 'dev' ? '“이메일 로그인 기능을 구현해 줘.”' : workspace === 'design' ? '“로그인 폼과 오류 상태를 디자인해 줘.”' : workspace === 'slack' ? '# login-release' : '로그인 경험 리뷰'}</h2>
              {isWork ? <>
                <div className="wd-agent-heading"><span className="wd-agent-mark" aria-hidden="true">{workspace === 'dev' ? '⌘' : '◈'}</span>{workspace === 'dev' ? '개발자 Agent' : '디자이너 Agent'}<span className="wd-version">산출물 예시 v{revision(state, workspace)}</span></div>
                <div className="wd-output-grid">
                  {workspace === 'dev' ? <pre className="wd-code"><code>{codeExample(updated)}</code></pre> : <LoginPreview updated={updated} />}
                  <div className="wd-result-summary"><span className="wd-eyebrow">작업 결과</span><h3>{workspace === 'dev' ? '이메일 로그인 구현' : '로그인 화면 · 3개 상태'}</h3><p>{workspace === 'dev' ? '로그인 요청과 실패 시 동작을 구현한 예시입니다.' : '기본·로딩·오류 화면을 디자인한 예시입니다. 왼쪽은 오류 상태입니다.'}</p><ul>{workspace === 'dev' ? <><li>이메일·비밀번호 입력</li><li>로그인 요청과 오류 처리</li><li>{updated ? '실패 시 입력 유지 · 공통 문구' : '실패 시 입력 초기화'}</li></> : <><li>단일 로그인 폼</li><li>로딩 중 중복 제출 방지</li><li>{updated ? '입력값이 남는 오류 상태' : '입력값이 비워진 오류 상태'}</li></>}</ul><button className="wd-text-button" onClick={() => setArtifact(workspace)}>산출물 자세히 보기 ↗</button></div>
                </div>
                {state.connected.slack && <p className="wd-inline-context">연결된 범위 · 이메일 로그인만, 소셜 로그인은 다음 릴리스 {sourceLink('slack')}</p>}
                {state.connected[workspace === 'dev' ? 'design' : 'dev'] && <div className="wd-related"><span>PM Agent가 가져온 관련 결과</span><button onClick={() => setArtifact(workspace === 'dev' ? 'design' : 'dev')}>{workspace === 'dev' ? '로그인 디자인' : '로그인 구현'} v{revision(state, workspace === 'dev' ? 'design' : 'dev')} ↗</button></div>}
              </> : workspace === 'slack' ? <div className="wd-thread"><article><strong>상성 <span>개발</span></strong><p>첫 릴리스에는 이메일 로그인까지 구현할게요. 소셜 로그인은 다음으로 미루는 게 어떨까요?</p></article><article><strong>지윤 <span>디자인</span></strong><p>좋아요. 화면에서도 소셜 로그인 버튼은 빼고, 이메일 로그인 흐름을 먼저 맞출게요.</p></article><div className="wd-decision-note"><span>합의된 범위</span><strong>이메일 로그인에 집중</strong><p>이유: 첫 릴리스에서 구현과 사용자 흐름을 함께 검토하기 위해.</p></div></div> : <div className="wd-meeting"><div className="wd-meeting-meta"><span>◎ 리뷰 미팅</span><span>상성 · 지윤</span></div><p>지윤: “로그인에 실패할 때마다 입력이 지워지면 다시 입력해야 해요.”</p><p>상성: “입력을 유지하고, 코드와 화면에 같은 오류 문구를 넣죠.”</p><div className="wd-decision-note"><span>결정 01 · 두 담당자 합의</span><strong>입력은 유지하고, 오류는 같은 문구로</strong><p>“{ERROR_COPY}”</p><p>이유: 재입력 부담을 줄이고 동작과 안내를 맞추기 위해.</p></div></div>}
              <div className="wd-actions"><button className="wd-primary" disabled={state.connected[workspace]} onClick={connect}>{state.connected[workspace] ? '✓ 프로젝트에 연결됨' : isWork ? '결과를 프로젝트에 공유' : '결정을 프로젝트에 연결'}</button><span>PM Agent가 출처와 관계를 연결합니다.</span></div>
              {isWork && state.connected.meeting && <div className={`wd-followup ${updated ? 'wd-reflected' : ''}`}><strong>{updated ? '✓ 미팅 결정 반영 · v2' : 'PM Agent · 이 작업에 반영할 결정'}</strong><p>{updated ? '입력 유지와 공통 오류 문구가 산출물에 반영된 예시입니다. 함께 검토하는 일은 남아 있습니다.' : workspace === 'dev' ? '입력 초기화를 제거하고 오류 문구를 바꿔야 합니다.' : '오류 화면에 입력값을 유지하고 공통 오류 문구를 적용해야 합니다.'}</p>{sourceLink('meeting')}{!updated && <button disabled={!state.connected[workspace]} onClick={() => revise(workspace)}>결정을 반영한 결과 확인</button>}{!state.connected[workspace] && <small>먼저 이 작업의 결과를 프로젝트에 공유하세요.</small>}</div>}
            </div>
          </div>
          <div className="wd-companion"><span className="wd-pm-avatar" aria-hidden="true">PM</span><div><h3>PM Agent <span>이 작업 공간에 함께</span></h3><p>{companion(state, workspace)}</p></div></div>
        </section>
        <aside id="project-context" hidden={!contextVisible} aria-label="프로젝트 맥락 보조 뷰">
          <div className="wd-context-header"><span className="wd-eyebrow">02 / PM AGENT가 연결한 맥락</span><span className="wd-aux">보조 뷰</span><h2>로그인 경험 개선</h2><p>결정의 이유부터 다음 행동까지</p></div>
          <section className="wd-context-section"><h3>작업과 담당 <span>{linked.length} / 2 연결</span></h3>{linked.length ? linked.map(source => <div key={source} className={`wd-context-item wd-${source}`}><strong>{source === 'dev' ? '로그인 구현 · 상성' : '로그인 디자인 · 지윤'}</strong><p>산출물 v{revision(state, source)} · {state.revised[source] ? '결정 반영 확인' : state.connected.meeting ? '미팅 결정 반영 필요' : '공유됨 · 검토 전'}</p>{sourceLink(source)}</div>) : <p className="wd-empty">각 공간에서 작업 결과를 공유하면 담당자와 산출물이 함께 연결됩니다.</p>}{bothLinked && <p className="wd-linked">↔ 같은 로그인 목표를 위한 구현과 디자인</p>}</section>
          <section className="wd-context-section"><h3>결정과 이유</h3>{!state.connected.slack && !state.connected.meeting && <p className="wd-empty">Slack의 범위 합의와 미팅 결정을 연결해 보세요.</p>}{state.connected.slack && <div className="wd-context-item"><strong>이메일 로그인에 집중</strong><p>첫 릴리스 범위를 맞추기 위해 소셜 로그인은 다음으로.</p>{sourceLink('slack')}</div>}{state.connected.meeting && <div className="wd-context-item"><strong>실패 시 입력 유지 · 공통 문구</strong><p>재입력 부담을 줄이고 구현과 화면을 맞추기 위해.</p>{sourceLink('meeting')}</div>}</section>
          <section className="wd-context-section"><h3>산출물 <span>내용과 버전 확인</span></h3>{linked.length ? linked.map(source => <button key={source} className="wd-artifact-link" onClick={() => setArtifact(source)}><span>{source === 'dev' ? '⌘ 로그인 구현' : '◈ 로그인 디자인'}</span><span>v{revision(state, source)} ↗</span></button>) : <p className="wd-empty">공유된 결과가 아직 없습니다.</p>}</section>
          <section className="wd-context-section wd-next"><h3>다음 행동</h3>{state.connected.meeting ? pending.length ? pending.map(source => <div key={source} className="wd-next-item"><p>{SOURCES[source].person} · {state.connected[source] ? '미팅 결정 반영 후 결과 확인' : '결과 공유 후 미팅 결정 반영'}</p><button onClick={() => goTo(source)}>{SOURCES[source].title} 작업으로 →</button></div>) : <><strong>구현·디자인 함께 검토</strong><p>두 결과에 결정이 반영되었습니다. 최종 검토는 아직 남아 있습니다.</p></> : <p>{bothLinked ? '미팅의 결정을 연결해 두 작업에 필요한 변경을 확인하세요.' : '각 작업의 결과를 공유하고 서로에게 필요한 맥락을 확인하세요.'}</p>}</section>
        </aside>
      </div>
      <footer className="wd-footer"><span>PM Agent · 맥락 이해 → 결정 전달 → 반영 확인 → 다음 행동</span><span>현재 예시는 새로고침하면 초기화됩니다.</span></footer>
    </main>
    <dialog className="wd-dialog" ref={dialog} aria-labelledby="artifact-title" onClose={() => setArtifact(null)} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.current?.close(); } }}>
      <div className="wd-dialog-top"><span className="wd-eyebrow">산출물 · 예시</span><button onClick={() => dialog.current?.close()} aria-label="산출물 닫기">닫기 ×</button></div>
      <h2 id="artifact-title">{artifact === 'dev' ? '로그인 구현' : '로그인 디자인'}{artifact && ` · v${revision(state, artifact)}`}</h2>
      {artifact && <><p className="wd-artifact-meta">{SOURCES[artifact].reference} · {SOURCES[artifact].person}</p>{artifact === 'dev' ? <pre className="wd-code"><code>{codeExample(state.revised.dev)}</code></pre> : <LoginPreview updated={state.revised.design} />}<p>{state.revised[artifact] ? '변경 근거: 로그인 리뷰 결정 01. 실패 시 입력 유지와 공통 오류 문구를 반영했습니다.' : '초안 v1: 오류가 발생하면 입력이 비워집니다. 다른 담당자의 결과와 함께 확인할 산출물입니다.'}</p><p className="wd-artifact-meta">설명용 산출물입니다. 실제 코드 실행·검증이나 외부 도구 변경을 수행하지 않습니다.</p></>}
    </dialog>
    <p className="wd-sr-only" role="status" aria-live="polite">{announcement}</p>
  </div>;
}
