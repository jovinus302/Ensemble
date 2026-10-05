'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { AGREE, CHANGE, DISCUSS, demoReducer, initialDemo, type Speaker, type Phase, type PendingCoordination, type PendingChoice } from './pm-coordination';
import './pm-coordination.css';

const people: { id: Speaker; name: string; role: string; initials: string; kind: string }[] = [
  { id: '서연', name: '김서연', role: '사람 · 기획 / 최종 결정', initials: '서', kind: 'human' },
  { id: '도윤', name: '박도윤', role: '사람 · UX / 공유 기준', initials: '도', kind: 'human' },
  { id: 'Story', name: 'Story Agent', role: '에이전트 · 생성 템플릿', initials: 'ST', kind: 'agent' },
  { id: 'UI', name: 'UI Agent', role: '에이전트 · 화면 구성', initials: 'UI', kind: 'agent' },
  { id: 'PM', name: 'Ensemble', role: 'PM 에이전트 · 조율 / 확인', initials: 'E', kind: 'pm' },
];
export function PmCoordinationDemo() {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemo);
  const [draft, setDraft] = useState('');
  const [format, setFormat] = useState('동화');
  const [fictionLevel, setFictionLevel] = useState('낮음 · 일상에 가깝게');
  const end = useRef<HTMLDivElement>(null);
  const { phase, revision, pending } = state;
  const choosePending = (choice: PendingChoice) => { if (pending) dispatch({ type: 'choose_pending', choice, run: state.run, request: pending.text }); };
  const busy = phase === 'comparing' || phase === 'executing' || phase === 'revising';
  const gate = phase === 'discussion' || phase === 'agreement' || phase === 'delivered';
  const expected = phase === 'discussion' ? DISCUSS : phase === 'agreement' ? AGREE : CHANGE;
  const writingAsDoyun = phase === 'discussion';
  const step = phase === 'intro' ? 0 : ['comparing', 'discussion', 'agreement'].includes(phase) ? 1 : ['executing', 'delivered'].includes(phase) ? 2 : 3;
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
    <header className="fd-top"><a className="fd-brand" href="/demo/pm-coordination"><i />ensemble</a><nav aria-label="시연 단계">{['Connect', 'Align', 'Deliver', 'Tuning & Loop'].map((label, i) => <span key={label} aria-current={i === step ? 'step' : undefined}>{label}</span>)}</nav><div className="fd-controls"><span className="fd-demo-label">SCRIPTED DEMO</span><button disabled={!state.history.length} onClick={() => dispatch({ type: 'back' })}>이전 단계</button><button onClick={() => dispatch({ type: 'reset' })}>처음부터</button><a href="/">실제 작업 화면 ↗</a></div></header>
    <div className="fd-banner">고정 시나리오 · 실제 모델 호출 / 외부 Figma·저장소 연동 없음 <span>약 3분 발표 구성 · 측정 성능 아님</span></div>
    <div className="fd-layout">
      <aside className="fd-sidebar"><div className="fd-project-icon">Pg</div><h1>Pages ·<br />함께 만드는 첫 화면</h1><p>사람의 합의를 실행으로</p><div className="fd-label">CHANNELS</div><div className="fd-channel-name"># pages-general</div><div className="fd-label">MEMBERS · 2 HUMANS + 3 AGENTS</div><div className="fd-members">{people.map(p => <div key={p.id} className="fd-member"><span className={`fd-avatar ${p.kind}`}>{p.initials}</span><div><b>{p.name}</b><small>{p.role}</small></div></div>)}</div><div className="fd-sidebar-note">사람은 방향을 결정합니다.<br />PM은 막힌 일을 연결합니다.<br />에이전트는 합의를 구현합니다.</div></aside>
      <section className="fd-chat" aria-label="팀 대화"><h2># pages-general <small className="fd-viewpoint">서연의 시점 · 나</small></h2><p className="fd-mobile-team">사람: 서연(기획) · 도윤(UX)<br />에이전트: Story(템플릿) · UI(화면) · PM(조율)</p><div className="fd-messages" role="log" aria-label="대화 기록">{state.messages.map((msg, i) => { const p = people.find(p => p.id === msg.speaker)!; return <article key={`${state.run}-${i}`} className={`fd-message ${p.kind} ${msg.speaker === '서연' ? 'own' : 'other'}`} data-message-speaker={msg.speaker} data-own={msg.speaker === '서연'}><span className={`fd-avatar ${p.kind}`} aria-hidden="true">{p.initials}</span><div className="fd-bubble"><div className="fd-meta"><b>{p.name}{msg.speaker === '서연' && <span className="fd-self-label">나</span>}</b><small>{p.kind === 'human' ? '사람' : p.kind === 'pm' ? 'PM AGENT' : 'AGENT'}</small></div><p>{msg.text}</p></div></article>; })}<div ref={end} /></div>
        <div className="fd-composer">{(phase === 'agreement' || phase === 'delivered') && pending && !['deferred', 'resolved'].includes(pending.status) && <div className="fd-pending-choices" aria-label="서연의 범위와 일정 선택"><b>서연의 선택 · 실행은 대기 중</b>{pending.kind === 'payment' ? <><button data-pending-choice="preview_only" onClick={() => choosePending('preview_only')}>기존 시안만 지금 · 결제는 별도 검토</button><button disabled={pending.status === 'held'} data-pending-choice="hold" onClick={() => choosePending('hold')}>시안도 보류 · 결제 범위부터 검토</button></> : pending.kind === 'schedule' ? <><button disabled={pending.status === 'prepared'} data-pending-choice="prepare_only" onClick={() => choosePending('prepare_only')}>기준만 준비 · 화면은 다음 주에</button><button data-pending-choice="start_now" onClick={() => choosePending('start_now')}>일정 변경 · 기존 시안 지금 보기</button></> : <p>범위·조건별로 다시 확인해야 합니다. 이 데모는 결제 추가 또는 다음 주 보류의 조율 예시를 지원합니다. 이전 단계로 돌아가 요청을 나눠 주세요.</p>}</div>}
          {phase === 'intro' && <><p>0–20초 · 목표와 팀 소개</p><button className="fd-primary" onClick={() => dispatch({ type: 'start' })}>팀 대화 시작</button></>}
          {gate && <form onSubmit={e => { e.preventDefault(); dispatch({ type: 'send', phase, text: draft }); setDraft(''); }}><label htmlFor="demo-message">{writingAsDoyun ? '도윤의 답변 작성 · 대신 입력' : '내 답변 · 서연'} · {phase === 'discussion' ? '비교안 검토' : phase === 'agreement' ? '첫 화면 시안 요청' : '결과 수정 요청'}</label><p className="fd-hint">검토 의견과 범위가 분명한 요청을 자연스럽게 써 주세요. 애매하거나 다른 범위이면 PM이 다시 묻습니다.</p><>{pending && !['deferred', 'resolved'].includes(pending.status) ? <p className="fd-hint">위 선택으로 범위·일정을 정해 주세요. 추가 의견은 아래에 남길 수 있습니다.</p> : <button type="button" className="fd-example" onClick={() => setDraft(expected)}>답변 초안 넣기</button>}</><textarea id="demo-message" maxLength={1000} value={draft} onChange={e => setDraft(e.target.value)} placeholder="사람의 답변을 기다리고 있어요…" rows={3} /><button className="fd-primary" disabled={!draft.trim()} type="submit">전송</button></form>}
          {busy && <p role="status"><span className="fd-dot" /> {phase === 'comparing' ? 'Story 비교안 준비 중 · 화면 제작은 대기' : phase === 'executing' ? '사람이 정한 범위로 Story·UI 작업 시작' : '영향받은 부분만 수정 중'}<small>스크립트 전환 · 실제 실행 아님</small></p>}
          {phase === 'complete' && <p className="fd-success">시연 완료 · 사람의 합의가 결과에 반영되었습니다.</p>}
          {state.notice && <p role="status">{state.notice}</p>}
        </div>
      </section>
      <section className="fd-work" aria-label="작업 맥락과 결과"><div className="fd-work-heading"><div><span className="fd-label">WORK CONTEXT</span><h2>{pending && !['deferred', 'resolved'].includes(pending.status) ? '범위·일정 조율' : phase === 'intro' ? 'Pages · 첫 화면' : !agreed ? '비교 → 사람의 판단' : revision === 2 ? '두 변경 · 나머지는 유지' : '기준 → 작업 → 결과'}</h2></div><span className="fd-version">{revision ? `v1.${revision - 1}` : '초안'}</span></div>
        <div className={`fd-decision ${agreed ? 'resolved' : ''}`}><div className="fd-decision-top"><b>D1 · {agreed ? '시안 기준' : '기준 검토'}</b><span>{agreed ? '✓ 서연 결정 · 도윤 검토' : phase === 'agreement' ? '서연의 시안 요청 대기' : '사람의 판단 대기'}</span></div>{agreed ? <div className="fd-criteria"><span>식별 단서 축약</span><span>표현 낮추기</span><span>fiction 3단계</span></div> : <strong>{pending ? '기존 시안 기준 준비 · 추가 판단 대기' : '이름만 바꾸면 충분할까요?'}</strong>}</div>
        {!pending && ['comparing', 'discussion', 'agreement'].includes(phase) && <section className="fd-comparison" data-testid="story-comparison" aria-label="Story Agent의 두 비교 초안"><h3>Story · 두 비교 초안</h3>{phase === 'comparing' ? <p role="status">같은 메모로 두 버전을 준비 중입니다. UI는 사람의 판단을 기다립니다.</p> : <><div className="fd-variants"><article><b>① 절제된 버전</b><p>낯선 동네의 작은 가게에서, 오래 알던 누군가가 우산을 건넸다.</p><small>사실감은 남기고 식별 단서는 축약</small></article><article><b>② 상상한 버전</b><p>비가 길을 지우던 밤, 우산 하나가 <mark>운명적 구원</mark>처럼 나타났다.</p><small>{phase === 'agreement' ? '사람의 검토: “뜻밖의 도움”으로 낮추기' : '사람이 재미와 과한 표현을 검토'}</small></article></div><p className="fd-comparison-note">Story 작성 → 도윤 검토 → 서연 판단</p></>}</section>}
        {pending && <details className="fd-log fd-reviewed-comparison"><summary>검토한 Story 비교안 보기</summary><p>① 절제: 낯선 동네의 작은 가게에서, 오래 알던 누군가가 우산을 건넸다.</p><p>② 상상: 비가 길을 지우던 밤, 우산 하나가 운명적 구원처럼 나타났다.</p><p>사람의 검토: “운명적 구원” → “뜻밖의 도움”. 식별 단서 축약 · fiction 3단계.</p></details>}
        {pending && <section className="fd-pending" data-testid="pending-coordination" data-kind={pending.kind} data-status={pending.status}><div><b>{pending.kind === 'payment' ? '결제 · 별도 요구' : pending.kind === 'schedule' ? '일정 · 다음 주 희망' : '추가 범위·조건 · 확인 필요'}</b><span>{pending.status === 'deferred' ? '별도 검토 대기' : pending.status === 'resolved' ? '사람이 지금 보기로 변경' : pending.status === 'prepared' ? '기준 준비 · UI 보류' : pending.status === 'held' ? '사람이 보류' : '서연 판단 대기'}</span></div><p>{pending.kind === 'payment' ? 'UI: 결제 흐름 검토 / Story: 이용 규칙 확인 · 공수 미정' : pending.kind === 'schedule' ? pending.status === 'resolved' ? '일정 변경 기록 · 기존 시안만 진행 · 자동 예약 없음' : pending.status === 'prepared' ? 'Story: 기준 메모 준비 / UI: 보류 · 실제 예약 없음' : '기준 준비 여부 선택 / UI: 보류 · 실제 예약 없음' : '원문 유지 · 영향·일정 추정 없음'}</p><details><summary>남겨 둔 요청 원문</summary><p>{pending.text}</p></details></section>}<CoordinationGraph key={state.run + phase + pending?.status} phase={phase} revision={revision} pending={pending} />
        <div className="fd-artifact"><div className="fd-artifact-title"><h3>Pages · 화면 미리보기</h3><small>로컬 데모 결과물</small></div><div className="fd-artifact-notes"><div className="fd-template" data-testid="story-template"><b>Story · 생성 템플릿 {revision ? `v1.${revision - 1}` : '대기'}</b>{revision ? <><div className="fd-phrase"><del>운명적 구원</del><span aria-hidden="true">↓</span><strong>뜻밖의 도움</strong></div><details className="fd-template-rules"><summary>생성 규칙 · 포맷 보기</summary><p>이름·장소·관계 → 식별 단서 축약</p><p>fiction → 낮음 / 중간 / 높음</p><p>포맷 → {revision === 2 ? '숏폼 · 동화 · 에세이' : '숏폼 · 동화 · 노래 · 에세이'}</p><small>고정 데모 · 실제 생성 없음</small></details></> : <p>사람의 기준 확정 후 반영</p>}</div>{phase === 'revising' || phase === 'complete' ? <div className="fd-change-list"><b>D2 · {revision === 2 ? '✓ 반영 완료' : '반영 중'}</b><div className="fd-change-chips"><span className="added">+ fiction 안내</span><span className="removed">− 노래</span><span className="kept">= D1 · 나머지 포맷 유지</span></div><small>{revision === 2 ? '도윤 검토 · PM 범위 확인' : '현재 화면 v1.0 · 갱신 대기'}</small></div> : null}</div><div className="fd-phone"><div className="fd-phone-top">9:41 <span>●●● ▮</span></div><h3>Pages<span>오늘을, 이야기로.</span></h3>{!revision ? <div className="fd-placeholder">{phase === 'comparing' ? 'Story 비교안 준비 · 화면 제작은 아직 대기' : busy ? '사람이 정한 기준으로 화면 구성 중…' : 'D1 합의 후 미리보기가 완성됩니다.'}<small>생성 템플릿 + 화면 구성</small></div> : <><div className="fd-story"><small>오늘의 Page · 식별 단서 축약</small><h4>비 오는 날의 뜻밖의 도움</h4><p>낯선 동네에서 만난, 오래 알던 누군가.<br />우산 하나가 뜻밖의 도움이 됩니다.</p>{revision === 2 && <p className="fd-disclosure" data-testid="fiction-disclosure">이 이야기는 fiction을 포함합니다. 인물·장소·관계는 각색했습니다.</p>}</div><label className="fd-fiction">fiction 수위<select aria-label="fiction 수위" value={fictionLevel} onChange={e => setFictionLevel(e.target.value)}><option>낮음 · 일상에 가깝게</option><option>중간 · 상상 더하기</option><option>높음 · 자유로운 이야기</option></select></label><p className="fd-format-label">지금 만들기 · 포맷 미리보기</p><div className="fd-formats">{(revision === 2 ? ['숏폼', '동화', '에세이'] : ['숏폼', '동화', '노래', '에세이']).map(f => <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)}>{f}</button>)}</div><p className="fd-preview-note">{format} 선택됨 · 실제 생성은 실행하지 않습니다</p></>}<div className="fd-phone-nav">home <span>채팅</span><span>feed</span></div></div>

        </div>
        <details className="fd-log"><summary>PM 조율 기록 · {agreed ? 'D1 확정' : '결정 대기'}{revision === 2 ? ' · D2 반영' : ''}</summary><p>걱정 구체화 → Story 비교안 요청 → 사람 간 검토 → 시안 범위 확인{agreed && ' → D1 기록 → 두 작업 재개'}{revision > 0 && ' → 도윤 결과 검토'}{revision === 2 && ' → D2 영향 범위만 변경 → 재확인'}</p><p>모든 발언·작업 상태·확인 결과는 시연용 스크립트입니다.</p></details>
        <p className="fd-pacing">발표 안내 · 0–20초 팀 소개 / 20–70초 합의 / 70–120초 실행 / 120–160초 수정 / 마지막 20초 요약</p>
      </section>
    </div>
  </main>;
}

/** A supporting map of the conversation, never a separate execution engine. */
function CoordinationGraph({ phase, revision, pending }: { phase: Phase; revision: number; pending?: PendingCoordination }) {
  const waitingCoordination = !!pending && !['deferred', 'resolved'].includes(pending.status) && (phase === 'agreement' || phase === 'delivered');
  const decided = ['executing', 'delivered', 'revising', 'complete'].includes(phase);
  const changing = phase === 'revising' || phase === 'complete';
  const working = phase === 'executing' || phase === 'revising';
  const humanActive = phase === 'discussion' || phase === 'agreement' || phase === 'delivered';
  const pmStatus = waitingCoordination && pending ? pending.status === 'prepared' ? '기준 준비 · 일정은 사람 판단' : '미결 범위·일정 조율' : phase === 'intro' ? '판단에 필요한 자료 연결' : phase === 'comparing' ? 'Story에 비교안 요청' : phase === 'discussion' ? '두 사람에게 조율 요청' : phase === 'agreement' ? '서연의 시안 요청 대기' : phase === 'executing' ? 'D1 기록 → 작업 배정' : phase === 'delivered' ? '도윤에게 결과 검토 요청' : phase === 'revising' ? 'D2 영향만 다시 배정' : '변경·유지 결과 확인';
  return <figure className="fd-graph" data-testid="coordination-graph" data-stage={phase} data-active-path={waitingCoordination && pending ? 'pending-human-choice' : phase === 'comparing' ? 'comparison-request' : working ? changing ? 'scoped-revision' : 'decision-handoff' : humanActive ? 'human-review' : 'none'} aria-label="PM이 연결하는 사람의 결정, 담당 작업, 결과물">
    <figcaption><span>PM 조율 맵</span><small>{changing ? '변경 경로만 강조 · D1 유지' : '사람의 판단 → PM 배정 → 결과'}</small></figcaption>
    <div className="fd-graph-canvas">
      <svg className="fd-graph-lines" viewBox="0 0 400 150" preserveAspectRatio="none" aria-hidden="true">
        <path className={humanActive ? 'active human' : ''} d="M88 25 C115 25 110 75 135 75 M88 125 C115 125 110 75 135 75" />
        <path className={working ? 'active' : ''} d="M185 75 C210 75 205 25 230 25 M185 75 C210 75 205 125 230 125" />
        <path className={changing ? 'active changed' : phase === 'executing' ? 'active' : ''} d="M285 25 L320 25 M285 125 L320 125" />
      </svg>
      <div className={`fd-graph-node human person-one ${phase === 'agreement' ? 'active' : ''}`}><small>사람 · 결정</small><b>김서연</b><span>{waitingCoordination && pending ? '범위·일정 선택' : changing ? 'D2 범위 확정' : decided ? 'D1 확정 · 인계' : '최종 판단 대기'}</span></div>
      <div className={`fd-graph-node human person-two ${phase === 'discussion' || phase === 'delivered' ? 'active' : ''}`}><small>사람 · UX 검토</small><b>박도윤</b><span>{revision ? '검토 · 2건 제안' : decided ? '결과 검토 대기' : phase === 'agreement' ? '검토안 전달' : '절충안 검토'}</span></div>
      <div className="fd-graph-node pm coordinator"><small>PM · 조율</small><b>Ensemble PM</b><span>{pmStatus}</span></div>
      <div className={`fd-graph-node agent story-owner ${working || phase === 'comparing' ? 'active' : ''}`}><small>에이전트</small><b>Story Agent</b><span>{waitingCoordination && pending ? pending.kind === 'payment' ? '이용 규칙 검토' : pending.status === 'prepared' ? '기준 메모 준비' : '추가 판단 대기' : phase === 'intro' ? '비교안 준비 대기' : phase === 'comparing' ? '비교안 2개 작성 중' : changing ? '노래만 제외' : decided ? 'D1 → 생성 규칙' : '비교안 전달'}</span></div>
      <div className={`fd-graph-node agent ui-owner ${working ? 'active' : ''}`}><small>에이전트</small><b>UI Agent</b><span>{waitingCoordination && pending ? pending.kind === 'payment' ? '결제 흐름 검토' : '화면 실행 보류' : changing ? '안내·선택지 수정' : decided ? 'D1 → 첫 화면' : 'D1 결정 대기'}</span></div>
      <div className={`fd-graph-node output story-output ${changing ? 'changed' : ''}`}><small>결과 · Story</small><b>생성 템플릿</b><span>{changing ? (phase === 'revising' ? '− 노래 · 반영 중' : '− 노래 · 반영 완료') : revision ? '단서 축약 · 3단계' : '규칙 반영 대기'}</span></div>
      <div className={`fd-graph-node output ui-output ${changing ? 'changed' : ''}`}><small>결과 · UI</small><b>Pages 화면</b><span>{changing ? (phase === 'revising' ? '+ 안내 / − 노래 · 반영 중' : '+ 안내 / − 노래 · 반영 완료') : revision ? 'v1.0 전달 완료' : '화면 반영 대기'}</span></div>
    </div>
    <p className="fd-graph-status" role="status" key={phase}><i />{pmStatus}</p>
  </figure>;
}
