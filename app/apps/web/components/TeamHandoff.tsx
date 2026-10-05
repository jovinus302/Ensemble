'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { initialHandoff, handoffReducer, type Action } from '../lib/team-handoff';
import './fixed-demo.css';
import './team-handoff.css';

const labels = { assigned: '담당 배정', working: '개인 작업 중', draft: '공유 준비', checking: 'PM 확인 중', review: '검토 대기', changes: '수정 필요', handed: '인계 완료' };
export function TeamHandoff() {
  const [s, dispatch] = useReducer(handoffReducer, undefined, initialHandoff);
  const [artifact, setArtifact] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openArtifact = () => { opener.current = document.activeElement as HTMLElement; setArtifact(true); };
  useEffect(() => {
    if (!artifact) return;
    return () => opener.current?.focus();
  }, [artifact]);
  const busy = s.phase === 'working' || s.phase === 'checking';
  const send = (type: Action['type'], version = s.version) => dispatch({ type, run: s.run, version });
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => dispatch({ type: s.phase === 'working' ? 'finish' : 'checked', run: s.run, version: s.version }), 1400);
    return () => clearTimeout(timer);
  }, [s.phase, s.run, s.version, busy]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [s.messages.length]);
  const step = ['assigned', 'working', 'draft', 'changes'].includes(s.phase) ? 0 : s.phase === 'handed' ? 3 : s.phase === 'review' ? 2 : 1;
  return <main className="fd th" data-phase={s.phase}>
    <header className="fd-top"><a className="fd-brand" href="/handoff"><i />ensemble</a><span className="th-kicker">사람의 일이, 팀의 다음 일로.</span><div className="fd-controls"><span className="fd-demo-label">SCRIPTED DEMO</span><button onClick={() => { send('reset'); setArtifact(false); }}>처음부터</button><a href="/demo">Pages 데모 ↗</a></div></header>
    <div className="fd-banner">로컬 시나리오 · 실제 모델 / IDE / Slack / Knox 연결 없음 <span>김상성 시점 · 검토 장면은 지윤 역할로 시연</span></div>
    <div className="fd-layout">
      <aside className="fd-sidebar"><div className="fd-project-icon">E</div><h1>좋은 시작을<br />만드는 팀</h1><p>로그인 복구 경험 개선</p><div className="fd-label">TEAM CHANNEL</div><div className="fd-channel-name"># product-experience</div><div className="fd-label">PEOPLE & AGENTS</div><div className="fd-members">{[['김상성 · 나', '개발 · 자신의 Coding Agent와 작업', '김', 'human'], ['이지윤', 'UX · 결과 검토', '이', 'human'], ['Ensemble PM', '목표 · 검토 · 다음 담당 조율', 'E', 'pm'], ['UX Agent', 'T-2 문구 검토 담당', 'UX', 'agent']].map(([name, role, initial, kind]) => <div className="fd-member" key={name}><span className={`fd-avatar ${kind}`}>{initial}</span><div><b>{name}</b><small>{role}</small></div></div>)}</div><div className="fd-sidebar-note">사람은 자기 agent와 일합니다.<br />PM은 공유된 결과로<br />팀의 다음 일을 연결합니다.</div></aside>
      <section className="fd-chat" aria-label="팀 업무 대화"><h2># product-experience <small>김상성 · 나의 시점</small></h2><div className="th-flow" aria-label="인계 진행">{['개인 작업', '팀 공유', '검토', '다음 일'].map((x, i) => <span key={x} className={i === step ? 'active' : i < step ? 'done' : ''}>{i + 1} {x}</span>)}</div>
        <div className="fd-messages" role="log" aria-label="팀에 공유된 대화">{s.messages.map((m, i) => <article key={`${s.run}-${i}`} className={`fd-message ${m.speaker === '나' ? 'own human' : m.speaker === 'PM' ? 'pm' : m.speaker === 'UX' ? 'agent' : 'human'}`}><span className={`fd-avatar ${m.speaker === 'PM' ? 'pm' : 'human'}`}>{m.speaker === 'PM' ? 'E' : m.speaker === '나' ? '김' : m.speaker === 'UX' ? 'UX' : '이'}</span><div className="fd-bubble"><div className="fd-meta"><b>{m.speaker === 'PM' ? 'Ensemble PM' : m.speaker === '나' ? '김상성 · 나' : m.speaker === 'UX' ? 'UX Agent' : '이지윤 · 리뷰어'}</b><small>{m.speaker === 'PM' ? '조율' : '팀 공유'}</small></div><p>{m.text}</p></div></article>)}<div ref={end} /></div>
        <div className="fd-composer">
          {['assigned', 'working', 'draft', 'changes'].includes(s.phase) && <div className="th-private"><div><b>나 + Coding Agent</b><span>개인 작업 공간 · 시연</span></div><p>{s.phase === 'working' ? `복구 화면 v${s.version}과 테스트 근거를 준비하고 있어요…` : s.phase === 'draft' ? `v${s.version} 준비 완료. 팀에 공유할 결과와 근거만 선택했어요.` : s.phase === 'changes' ? '포커스 복귀 수정 요청을 가지고 내 agent와 이어서 작업합니다.' : '내 agent와 직접 작업합니다. PM을 통해 실행을 요청하지 않습니다.'}</p><small>비공개 대화는 팀 작업 상태에 수집되지 않습니다.</small></div>}
          <div className="th-actions">
            {(s.phase === 'assigned' || s.phase === 'changes') && <button className="fd-primary" onClick={() => send('work')}>{s.phase === 'changes' ? '내 Agent와 수정하기' : '내 Coding Agent와 작업하기'}</button>}
            {s.phase === 'draft' && <><button onClick={openArtifact}>공유할 결과 미리보기</button><button className="fd-primary" onClick={() => send('share')}>T-1에 결과와 근거 공유</button></>}
            {busy && <><p role="status"><span className="fd-dot" />{s.phase === 'working' ? '개인 작업 시연 중' : 'PM이 완료 기준과 의존성을 확인 중'}</p><button onClick={e => { if (e.detail < 2) send('cancel'); }}>진행 취소</button></>}
            {s.phase === 'review' && <><p className="th-review-label">이지윤 역할 · 현재 v{s.version} 검토</p><button onClick={() => send('reject')}>수정 요청 · 포커스 복귀</button><button className="fd-primary" onClick={() => send('approve')}>검토 승인 · 다음 담당에게</button></>}
            {s.phase === 'handed' && <p className="fd-success">T-2에 맥락 전달 완료 · UX 결과는 아직 대기 중입니다.</p>}
          </div>{s.notice && <p role="status" className="th-notice">{s.notice}</p>}
        </div>
      </section>
      <aside className="fd-work" aria-label="팀 작업 상태"><div className="fd-work-heading"><div><span className="fd-label">TEAM WORK STATE</span><h2>공유된 결과가<br />다음 일을 엽니다.</h2></div><span className="fd-version">{labels[s.phase]}</span></div>
        <div className="th-goal"><small>목표 G-1</small><b>로그인에 실패해도, 다시 시작할 수 있게</b><p>완료 기준 · 만료 링크 복구 / 키보드 포커스 복귀</p></div>
        <div className="th-task"><div><b>T-1 · 로그인 오류 처리</b><span>{s.phase === 'handed' ? '완료' : s.phase === 'changes' ? '수정 필요' : s.phase === 'review' ? '검토 대기' : '진행 중'}</span></div><p>담당 김상성 · 검토 이지윤</p><small>{s.shared ? `팀에 공유된 결과 v${s.shared}${s.shared < s.version ? ' · 이전 버전 / 승인 불가' : ''}` : '팀에 공유된 산출물 없음'}</small>{s.shared > 0 && <button onClick={openArtifact}>복구 화면 + 테스트 근거 v{s.shared}</button>}</div>
        <div className={`th-task ${s.phase === 'handed' ? 'th-ready' : ''}`}><div><b>T-2 · 오류 안내 문구 검토</b><span>{s.phase === 'handed' ? '인계됨' : '대기'}</span></div><p>담당 UX Agent</p><small>{s.phase === 'handed' ? `전달: G-1 + T-1 v${s.version} + 검토 결정` : '선행 조건 · T-1 현재 버전 검토 승인'}</small>{s.phase === 'handed' && <p>유지할 결정: 복구 동작과 키보드 접근성.<br />다음 범위: 문구와 버튼 표현 검토.</p>}</div>
        <figure className="th-graph"><figcaption>작업의 연결 <small>공유와 검토에 반응합니다</small></figcaption><div><span className="done">목표 G-1</span><i>→</i><span className={s.shared ? 'done' : 'active'}>T-1 / 김상성</span></div><div><span className={s.shared ? 'done' : ''}>공유 결과{s.shared ? ` v${s.shared}` : ''}</span><i>→</i><span className={s.phase === 'review' ? 'active' : s.phase === 'handed' ? 'done' : ''}>검토 결정</span></div><div className={s.phase === 'handed' ? 'th-linked' : ''}><span className={s.phase === 'handed' ? 'done' : ''}>T-2 / UX Agent</span></div></figure>
        <details className="th-history"><summary>결정 · 이력 ({s.messages.filter(m => m.speaker === 'PM' || m.speaker === '리뷰어').length})</summary>{s.messages.filter(m => m.speaker === 'PM' || m.speaker === '리뷰어').map((m, i) => <p key={i}>{m.text}</p>)}</details>
        {s.version > 1 && <details className="th-history"><summary>이전 버전 확인 · v{s.version - 1}</summary><p>이전 결과로 현재 작업을 완료할 수 없습니다.</p><button onClick={() => send('share', s.version - 1)}>이전 결과 재공유 시도</button><button onClick={() => send('approve', s.version - 1)}>이전 검토 승인 시도</button></details>}
        <p className="th-footnote">팀에 공유한 결과와 결정만 연결합니다.<br />개인 대화와 실제 외부 agent는 연결되지 않았습니다.</p>
      </aside>
    </div>
    {artifact && <div className="th-modal" onClick={() => setArtifact(false)}><section role="dialog" aria-modal="true" aria-label="공유 산출물" onClick={e => e.stopPropagation()}><button autoFocus onClick={() => setArtifact(false)} onKeyDown={e => { if (e.key === 'Escape') setArtifact(false); if (e.key === 'Tab') e.preventDefault(); }}>닫기</button><span className="fd-label">T-1 · {s.phase === 'draft' ? `공유 전 v${s.version}` : `공유된 v${s.shared}`} · 시나리오 산출물</span><h2>다시 시작할 수 있어요.</h2><p>로그인 링크가 만료됐어요.<br />새 링크를 받아 이어서 진행해 주세요.</p><div className="th-preview-button">새 로그인 링크 받기</div><h3>첨부된 근거</h3><p>복구 화면 변경 요약 · 만료 상태 안내와 재시도 버튼</p><p>키보드 테스트 기록 · Tab 이동과 복구 버튼 포커스 확인</p><small>고정 예시 자료입니다. 실제 코드 실행이나 테스트 측정 결과가 아닙니다. 검토자는 별도로 승인하거나 수정을 요청합니다.</small></section></div>}
  </main>;
}
