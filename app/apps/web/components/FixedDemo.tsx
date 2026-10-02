'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { AGREE, CHANGE, DISCUSS, demoReducer, initialDemo, type Speaker, type Phase } from '../lib/fixed-demo';
import './fixed-demo.css';

const people: { id: Speaker; name: string; role: string; initials: string; kind: string }[] = [
  { id: '서연', name: '김서연', role: '사람 · 기획 / 최종 결정', initials: '서', kind: 'human' },
  { id: '도윤', name: '박도윤', role: '사람 · UX / 공유 기준', initials: '도', kind: 'human' },
  { id: 'Story', name: 'Story Agent', role: '에이전트 · 생성 템플릿', initials: 'ST', kind: 'agent' },
  { id: 'UI', name: 'UI Agent', role: '에이전트 · 화면 구성', initials: 'UI', kind: 'agent' },
  { id: 'PM', name: 'Ensemble', role: 'PM 에이전트 · 조율 / 확인', initials: 'E', kind: 'pm' },
];
export function FixedDemo() {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemo);
  const [draft, setDraft] = useState('');
  const [format, setFormat] = useState('동화');
  const [fictionLevel, setFictionLevel] = useState('낮음 · 일상에 가깝게');
  const end = useRef<HTMLDivElement>(null);
  const { phase, revision } = state;
  const busy = phase === 'executing' || phase === 'revising';
  const gate = phase === 'discussion' || phase === 'agreement' || phase === 'delivered';
  const expected = phase === 'discussion' ? DISCUSS : phase === 'agreement' ? AGREE : CHANGE;
  const current = phase === 'discussion' ? '박도윤' : '김서연';
  const step = phase === 'intro' ? 0 : ['discussion', 'agreement'].includes(phase) ? 1 : ['executing', 'delivered'].includes(phase) ? 2 : 3;
  const agreed = step >= 2;
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => dispatch({ type: 'finish', run: state.run, phase }), 2200);
    return () => clearTimeout(timer);
  }, [busy, phase, state.run]);
  useEffect(() => { setDraft(''); }, [phase, state.run]);
  useEffect(() => { setFormat('동화'); setFictionLevel('낮음 · 일상에 가깝게'); }, [state.run]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }, [state.messages.length]);
  useEffect(() => { if (revision === 2 && format === '노래') setFormat('동화'); }, [revision, format]);
  return <main className="fd" data-phase={phase}>
    <header className="fd-top"><a className="fd-brand" href="/demo"><i />ensemble</a><nav aria-label="시연 단계">{['Connect', 'Align', 'Deliver', 'Tuning & Loop'].map((label, i) => <span key={label} aria-current={i === step ? 'step' : undefined}>{label}</span>)}</nav><div className="fd-controls"><span className="fd-demo-label">SCRIPTED DEMO</span><button disabled={!state.history.length} onClick={() => dispatch({ type: 'back' })}>이전 단계</button><button onClick={() => dispatch({ type: 'reset' })}>처음부터</button><a href="/">실제 작업 화면 ↗</a></div></header>
    <div className="fd-banner">고정 시나리오 · 실제 모델 호출 / 외부 Figma·저장소 연동 없음 <span>약 3분 발표 구성 · 측정 성능 아님</span></div>
    <div className="fd-layout">
      <aside className="fd-sidebar"><div className="fd-project-icon">Pg</div><h1>Pages ·<br />함께 만드는 첫 화면</h1><p>사람의 합의를 실행으로</p><div className="fd-label">CHANNELS</div><div className="fd-channel-name"># pages-general</div><div className="fd-label">MEMBERS · 2 HUMANS + 3 AGENTS</div><div className="fd-members">{people.map(p => <div key={p.id} className="fd-member"><span className={`fd-avatar ${p.kind}`}>{p.initials}</span><div><b>{p.name}</b><small>{p.role}</small></div></div>)}</div><div className="fd-sidebar-note">사람은 방향을 결정합니다.<br />PM은 막힌 일을 연결합니다.<br />에이전트는 합의를 구현합니다.</div></aside>
      <section className="fd-chat" aria-label="팀 대화"><h2># pages-general <small>사람 ↔ 사람 ↔ 에이전트</small></h2><p className="fd-mobile-team">사람: 서연(기획) · 도윤(UX)<br />에이전트: Story(템플릿) · UI(화면) · PM(조율)</p><div className="fd-messages" role="log" aria-label="대화 기록">{state.messages.map((msg, i) => { const p = people.find(p => p.id === msg.speaker)!; return <article key={`${state.run}-${i}`} className={`fd-message ${p.kind}`}><span className={`fd-avatar ${p.kind}`}>{p.initials}</span><div><div className="fd-meta"><b>{p.name}</b><small>{p.kind === 'human' ? '사람' : p.kind === 'pm' ? 'PM AGENT' : 'AGENT'}</small></div><p>{msg.text}</p></div></article>; })}<div ref={end} /></div>
        <div className="fd-composer">
          {phase === 'intro' && <><p>0–20초 · 목표와 팀 소개</p><button className="fd-primary" onClick={() => dispatch({ type: 'start' })}>팀 대화 시작</button></>}
          {gate && <form onSubmit={e => { e.preventDefault(); dispatch({ type: 'send', phase, text: draft }); setDraft(''); }}><label htmlFor="demo-message">{current} 역할로 채팅하기 · {phase === 'discussion' ? '절충안 제안' : phase === 'agreement' ? '사람의 최종 결정' : '결과 수정 요청'}</label><p className="fd-hint">자유 의견·반대는 기록되며 진행하지 않습니다. 고정 흐름은 예시 문장을 전송하세요.</p><button type="button" className="fd-example" onClick={() => setDraft(expected)}>예시 문장 넣기</button><textarea id="demo-message" maxLength={1000} value={draft} onChange={e => setDraft(e.target.value)} placeholder="사람의 답변을 기다리고 있어요…" rows={3} /><button className="fd-primary" disabled={!draft.trim()} type="submit">전송</button></form>}
          {busy && <p role="status"><span className="fd-dot" /> {phase === 'executing' ? '합의 반영 중 · 두 에이전트 작업 자동 재개' : '영향받은 부분만 수정 중'}<small>스크립트 전환 · 실제 실행 아님</small></p>}
          {phase === 'complete' && <p className="fd-success">시연 완료 · 사람의 합의가 결과에 반영되었습니다.</p>}
          {state.notice && <p role="status">{state.notice}</p>}
        </div>
      </section>
      <section className="fd-work" aria-label="작업 맥락과 결과"><div className="fd-work-heading"><div><span className="fd-label">WORK CONTEXT</span><h2>{phase === 'intro' ? '함께 결정하고, 함께 완성하기' : !agreed ? '한 결정이 두 작업을 막고 있습니다' : revision === 2 ? '요청한 두 곳만 바뀌었습니다' : '합의가 실행으로 연결됩니다'}</h2></div><span className="fd-version">{revision ? `v1.${revision - 1}` : '초안'}</span></div>
        <div className={`fd-decision ${agreed ? 'resolved' : ''}`}><span className="fd-label">D1 · FICTION / 공유 기준</span><strong>{agreed ? 'B 확정 · 자동 가명화 + fiction 3단계' : '창작의 자유 ↔ 실존 인물 보호'}</strong><p>{agreed ? '결정자 김서연 · 제안 박도윤 · PM 기록 완료' : phase === 'intro' ? '목표: 하루의 기록으로 공유 가능한 이야기를 만들기' : `대기 이유: ${phase === 'agreement' ? '김서연의 최종 확정 답변' : '박도윤·김서연의 합의 필요'}`}</p>{!agreed && <div className="fd-options"><span>A · 실명 유지 / 공유 보류</span><span>B · 자동 가명화 / 3단계 선택</span></div>}</div>
        <CoordinationGraph key={state.run + phase} phase={phase} revision={revision} />
        <div className="fd-artifact"><div className="fd-artifact-title"><h3>Pages · 화면 미리보기</h3><small>로컬 데모 결과물</small></div><div className="fd-artifact-notes"><div className="fd-template" data-testid="story-template"><b>Story · 생성 템플릿 {revision ? `v1.${revision - 1}` : '대기'}</b>{revision ? <><p>인물·장소 → 자동 가명화</p><p>fiction → 낮음 / 중간 / 높음</p><p>포맷 → {revision === 2 ? '숏폼 · 동화 · 에세이' : '숏폼 · 동화 · 노래 · 에세이'}</p><small>데모 템플릿 · 실제 생성 없음</small></> : <p>D1 합의 후 규칙과 포맷을 반영합니다.</p>}</div>          {phase === 'revising' || phase === 'complete' ? <div className="fd-change-list"><b>D2 · 서연의 변경 요청</b><p>추가: fiction 안내 · 제거: 노래 포맷</p><p>유지: D1 가명화 / 3단계 · 나머지 포맷</p><small>{revision === 2 ? 'PM 데모 확인: 안내 있음 · 노래 없음 · D1 유지' : '기존 v1.0 표시 중 · 영향받은 영역만 갱신 예정'}</small></div> : <p className="fd-artifact-note">사람의 결정 D1 → 템플릿·화면 → PM 결과 확인</p>}</div><div className="fd-phone"><div className="fd-phone-top">9:41 <span>●●● ▮</span></div><h3>Pages<span>오늘을, 이야기로.</span></h3>{!revision ? <div className="fd-placeholder">{busy ? '확정된 기준으로 화면 구성 중…' : 'D1 합의 후 미리보기가 완성됩니다.'}<small>생성 템플릿 + 화면 구성</small></div> : <><div className="fd-story"><small>오늘의 Page · 가명화 적용</small><h4>퇴근길, 비를 피한 고양이</h4><p>이름 없는 골목에서 만난 작은 친구.<br />오늘의 기억이 새로운 이야기가 됩니다.</p>{revision === 2 && <p className="fd-disclosure" data-testid="fiction-disclosure">이 이야기는 fiction을 포함합니다. 인물·장소는 가명입니다.</p>}</div><label className="fd-fiction">fiction 수위<select aria-label="fiction 수위" value={fictionLevel} onChange={e => setFictionLevel(e.target.value)}><option>낮음 · 일상에 가깝게</option><option>중간 · 상상 더하기</option><option>높음 · 자유로운 이야기</option></select></label><p className="fd-format-label">지금 만들기 · 포맷 미리보기</p><div className="fd-formats">{(revision === 2 ? ['숏폼', '동화', '에세이'] : ['숏폼', '동화', '노래', '에세이']).map(f => <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)}>{f}</button>)}</div><p className="fd-preview-note">{format} 선택됨 · 실제 생성은 실행하지 않습니다</p></>}<div className="fd-phone-nav">home <span>채팅</span><span>feed</span></div></div>

        </div>
        <details className="fd-log"><summary>PM 조율 기록 · {agreed ? 'D1 확정' : '결정 대기'}{revision === 2 ? ' · D2 반영' : ''}</summary><p>충돌 감지 → 관련 사람에게 질문 → 사람 간 논의 → 최종 결정 대기{agreed && ' → D1 기록 → 두 작업 재개'}{revision > 0 && ' → 결과 확인'}{revision === 2 && ' → D2 영향 범위만 변경 → 재확인'}</p><p>모든 발언·작업 상태·확인 결과는 시연용 스크립트입니다.</p></details>
        <p className="fd-pacing">발표 안내 · 0–20초 팀 소개 / 20–70초 합의 / 70–120초 실행 / 120–160초 수정 / 마지막 20초 요약</p>
      </section>
    </div>
  </main>;
}

/** A supporting map of the conversation, never a separate execution engine. */
function CoordinationGraph({ phase, revision }: { phase: Phase; revision: number }) {
  const decided = ['executing', 'delivered', 'revising', 'complete'].includes(phase);
  const changing = phase === 'revising' || phase === 'complete';
  const working = phase === 'executing' || phase === 'revising';
  const humanActive = phase === 'discussion' || phase === 'agreement' || phase === 'delivered';
  const pmStatus = phase === 'intro' ? '역할 연결' : phase === 'discussion' ? '두 사람에게 조율 요청' : phase === 'agreement' ? '서연의 최종 결정 대기' : phase === 'executing' ? 'D1 기록 → 작업 배정' : phase === 'delivered' ? '도윤에게 결과 검토 요청' : phase === 'revising' ? 'D2 영향만 다시 배정' : '변경·유지 결과 확인';
  return <figure className="fd-graph" data-testid="coordination-graph" data-stage={phase} data-active-path={working ? changing ? 'scoped-revision' : 'decision-handoff' : humanActive ? 'human-review' : 'none'} aria-label="PM이 연결하는 사람의 결정, 담당 작업, 결과물">
    <figcaption><span>PM 조율 맵</span><small>{changing ? '변경 경로만 강조 · D1 유지' : '사람의 판단 → PM 배정 → 결과'}</small></figcaption>
    <div className="fd-graph-canvas">
      <svg className="fd-graph-lines" viewBox="0 0 400 150" preserveAspectRatio="none" aria-hidden="true">
        <path className={humanActive ? 'active human' : ''} d="M88 25 C115 25 110 75 135 75 M88 125 C115 125 110 75 135 75" />
        <path className={working ? 'active' : ''} d="M185 75 C210 75 205 25 230 25 M185 75 C210 75 205 125 230 125" />
        <path className={changing ? 'active changed' : phase === 'executing' ? 'active' : ''} d="M285 25 L320 25 M285 125 L320 125" />
      </svg>
      <div className={`fd-graph-node human person-one ${phase === 'agreement' ? 'active' : ''}`}><small>사람 · 방향 결정</small><b>김서연</b><span>{changing ? 'D2 범위 확정' : decided ? 'D1 확정 · 인계' : '최종 판단 대기'}</span></div>
      <div className={`fd-graph-node human person-two ${phase === 'discussion' || phase === 'delivered' ? 'active' : ''}`}><small>사람 · UX 검토</small><b>박도윤</b><span>{revision ? '결과 검토 · 2건 제안' : decided ? '결과 검토 대기' : phase === 'agreement' ? '절충안 전달 완료' : '절충안 검토'}</span></div>
      <div className="fd-graph-node pm coordinator"><small>조율 · 기록 · 확인</small><b>Ensemble PM</b><span>{pmStatus}</span></div>
      <div className={`fd-graph-node agent story-owner ${working ? 'active' : ''}`}><small>에이전트 · 담당</small><b>Story Agent</b><span>{changing ? '노래만 제외' : decided ? 'D1 → 생성 규칙' : 'D1 결정 대기'}</span></div>
      <div className={`fd-graph-node agent ui-owner ${working ? 'active' : ''}`}><small>에이전트 · 담당</small><b>UI Agent</b><span>{changing ? '안내·선택지 수정' : decided ? 'D1 → 첫 화면' : 'D1 결정 대기'}</span></div>
      <div className={`fd-graph-node output story-output ${changing ? 'changed' : ''}`}><small>결과 · Story</small><b>생성 템플릿</b><span>{changing ? (phase === 'revising' ? '− 노래 · 반영 중' : '− 노래 · 반영 완료') : revision ? '가명화 · 3단계' : '규칙 반영 대기'}</span></div>
      <div className={`fd-graph-node output ui-output ${changing ? 'changed' : ''}`}><small>결과 · UI</small><b>Pages 화면</b><span>{changing ? (phase === 'revising' ? '+ 안내 / − 노래 · 반영 중' : '+ 안내 / − 노래 · 반영 완료') : revision ? 'v1.0 전달 완료' : '화면 반영 대기'}</span></div>
    </div>
    <p className="fd-graph-status" role="status" key={phase}><i />{pmStatus}{changing && ' · 유지: 가명화 / fiction 3단계 / 나머지 포맷'}</p>
  </figure>;
}
