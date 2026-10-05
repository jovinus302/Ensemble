'use client';
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import jiyoonPhoto from './assets/jiyoon-generated.png';
import sangPhoto from './assets/sang-generated.png';
import ensembleLogo from './assets/ensemble-logo.svg';
import ensembleSymbol from './assets/ensemble-symbol.svg';
import { initialHandoff, handoffReducer, isBusy, nextAction, choices, type Action, type Artifact, type Entry, type State } from './design-to-code';
import './design-to-code.css';

type Person = 'jiyoon' | 'sang' | 'pm' | 'ux' | 'code' | 'qa';
const people: Record<Person, { name: string; role: string; photo?: string }> = {
  jiyoon: { name: '이지윤', role: 'UX · 화면 검토', photo: jiyoonPhoto.src },
  sang: { name: '김상성', role: '개발 · 나', photo: sangPhoto.src },
  pm: { name: 'Ensemble PM', role: '팀 조율' }, ux: { name: 'UX Agent', role: '지윤의 Agent' },
  code: { name: 'Coding Agent', role: '상성의 Agent' }, qa: { name: 'QA Agent', role: '공유 결과 검증' },
};
function Avatar({ who }: { who: Person }) {
  const [failed, setFailed] = useState(false);
  const p = people[who];
  const photo = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (photo.current?.complete && photo.current.naturalWidth === 0) setFailed(true);
  }, [p.photo]);
  return <span className={`hf-avatar ${who} ${p.photo ? 'person' : 'agent'}`}>
    {p.photo && !failed ? <img ref={photo} src={p.photo} alt={`${p.name} 역할의 생성된 가상인물 사진`} onError={() => setFailed(true)} /> : p.photo ? <span role="img" aria-label={`${p.name} 사진 대체 아바타`}>{who === 'sang' ? '성' : '윤'}</span> : <svg viewBox="0 0 32 32" role="img" aria-label={`${p.name} 아이콘`}><rect x="5" y="8" width="22" height="18" rx="6" /><path d={who === 'code' ? 'M12 13l-4 4 4 4m8-8 4 4-4 4m-3-9-2 12' : who === 'ux' ? 'M11 13h10v8H11zm0 4h10' : who === 'qa' ? 'M10 17l4 4 8-9' : 'M10 17h12m-6-6v12'} /><path d="M16 4v4M2 15v5m28-5v5" /></svg>}
  </span>;
}
const label = (a: Artifact) => a.kind === 'design' ? 'UX 초안' : `구현 v${a.version}`;
function Preview({ artifact: a, interactive = false }: { artifact: Artifact | null; interactive?: boolean }) {
  const [result, setResult] = useState('');
  const recovery = useRef<HTMLButtonElement>(null), error = useRef<HTMLParagraphElement>(null);
  const title = a ? a.refined ? a.choice === 'login' ? '다시 로그인하기' : '새 로그인 링크 받기' : choices[a.choice].title : '확인';
  return <div className={`hf-preview ${a ? 'updated' : 'before'}`} data-testid="artifact-preview"><div className="hf-preview-bar">◈ PRODUCT / LOGIN <span>•••</span></div><div className="hf-preview-content"><span className="hf-mail-icon">↗</span><h3>{a ? '로그인 링크가 만료됐어요' : '오류가 발생했습니다'}</h3><p ref={error} tabIndex={interactive ? -1 : undefined}>{a ? a.choice === 'login' ? '로그인 화면에서 다시 시작해 주세요.' : '새 링크를 받아 이어서 진행해 주세요.' : '요청을 처리할 수 없습니다.'}</p>{a && <small>{a.privacy ? 's***@example.com' : 'sang@example.com'}</small>}{interactive ? <button ref={recovery} className="hf-recovery" disabled={!a || result === 'sent'} onClick={() => setResult(a?.choice === 'resend' ? 'sent' : 'login')}>{result === 'sent' ? '발송됨 · 60초 후 다시 시도' : title}</button> : <div className="hf-recovery">{title}</div>}{a?.choice === 'resend' && <p className="hf-limit">재발송 후 60초 동안 다시 보낼 수 없어요.</p>}{result && <p className="hf-result">{result === 'sent' ? '✓ 재발송 예시 · 실제 메일은 보내지 않았어요.' : '✓ 로그인 화면 이동 미리보기'}</p>}</div>{interactive && a?.kind === 'build' && <div className="hf-probe"><button onClick={() => { setResult(''); setTimeout(() => a.focus ? recovery.current?.focus() : error.current?.focus(), 0); }}>오류 후 포커스 확인</button><p>{a.focus ? '복구 버튼으로 포커스가 돌아옵니다.' : '누락 사례: 오류 문장에 포커스가 남습니다.'}</p></div>}</div>;
}
function Trail({ entry, entries }: { entry: Entry; entries: Entry[] }) {
  return entry.refs?.length ? <details className="hf-trail"><summary>연결된 대화·근거 {entry.refs.length}</summary>{entry.refs.map(id => { const e = entries.find(x => x.id === id); return e && <blockquote key={id}><b>{people[e.speaker].name}</b>{e.text}</blockquote>; })}</details> : null;
}
function Card({ e, entries, open }: { e: Entry; entries: Entry[]; open: (a: Artifact | null) => void }) {
  let content: ReactNode;
  if (e.kind === 'issue') return <div className="hf-issue"><div><span className="hf-eyebrow">지금 사용자에게 보이는 화면</span><strong>막혔는데, 다음 행동이 없다.</strong><p>만료된 로그인 링크의 복구 경험을 바꿉니다.</p></div><button className="hf-old-artifact" onClick={() => open(null)}><span>!</span><b>오류가 발생했습니다</b><small>요청을 처리할 수 없습니다.</small><i>확인</i></button></div>;
  if (e.kind === 'proposal') content = <><div className="hf-card-label">PM의 정리 <span>합의 전</span></div><h3>{choices[e.choice!].title}</h3><div className="hf-constraint"><span>지윤의 의도<b>다음 행동을 분명하게</b></span><span>상성의 제약<b>{choices[e.choice!].constraint}</b></span></div><div className="hf-tags"><span>키보드로도 복구</span>{e.privacy && <span className="new">+ 이메일 가리기</span>}</div></>;
  if (e.kind === 'plan') content = <><div className="hf-card-label">합의 → 작업 <span>두 사람 동의</span></div><h3>{choices[e.choice!].title}</h3><div className="hf-chain"><span><Avatar who="jiyoon" /><b>UX 초안</b><small>지윤 + UX</small></span><i>→</i><span><Avatar who="sang" /><b>구현</b><small>상성 + Coding</small></span><i>→</i><span><Avatar who="qa" /><b>근거 확인</b><small>QA → 사람 검토</small></span></div></>;
  if (e.kind === 'artifact') content = <><div className="hf-card-label">공유된 산출물 <span>{label(e.artifact!)}</span></div><button className="hf-artifact-open" onClick={() => open(e.artifact!)}><span><b>로그인 복구 화면</b><small>{choices[e.artifact!.choice].title}{e.artifact!.privacy ? ' · 주소 가림' : ''}</small></span><span>↗</span></button><div className="hf-diff"><del>오류 · 확인</del><span>→</span><strong>{e.artifact!.refined ? '명확한 버튼 문구' : '이유 + 다음 행동'}</strong>{e.artifact!.focus && <em>+ 포커스 복귀</em>}</div></>;
  if (e.kind === 'qa') content = <><div className="hf-card-label">QA 근거 · v{e.artifact!.version}<span>{e.passed ? '3/3 확인' : '2/3 · 보완 필요'}</span></div><p>✓ 합의한 복구 동작 <span>✓ {e.artifact!.privacy ? '이메일 가리기' : '만료 이유 안내'}</span></p><strong>{e.passed ? '✓ 오류 후 버튼으로 포커스 복귀' : '! 복구 버튼으로 키보드 포커스가 돌아오지 않음'}</strong></>;
  if (e.kind === 'handoff') content = <><div className="hf-card-label">다음 일로 연결 <span>검토 완료</span></div><h3>모바일 배포 점검</h3><div className="hf-owner"><Avatar who="jiyoon" /><span><b>이지윤 + QA Agent</b><small>구현 v{e.artifact!.version} · 결정 · QA 근거 전달</small></span></div></>;
  return content ? <div className={`hf-card ${e.kind} ${e.kind === 'qa' && !e.passed ? 'fail' : ''}`}>{content}<Trail entry={e} entries={entries} /></div> : <Trail entry={e} entries={entries} />;
}
function Owners({ s }: { s: State }) {
  const rows = [['ux', '지윤 + UX Agent', s.design ? '공유 완료' : s.agreed ? '초안 준비' : '합의 대기'], ['code', '상성 + Coding Agent', s.shared?.kind === 'build' ? s.shared.version < s.version ? '수정 중' : '공유 완료' : s.design ? '구현 준비' : 'UX 초안 대기'], ['qa', 'QA Agent', s.evidence?.version === s.version ? s.evidence.passed ? '기준 확인' : '보완 요청' : '구현 공유 대기']];
  return <div className="hf-owner-list">{rows.map(([who, name, status]) => <div key={who}><Avatar who={who as Person} /><span><b>{name}</b><small>{status}</small></span></div>)}</div>;
}
export function DesignToCodeDemo() {
  const [s, dispatch] = useReducer(handoffReducer, undefined, initialHandoff);
  const [modal, setModal] = useState<{ artifact: Artifact | null } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), end = useRef<HTMLDivElement>(null), opener = useRef<HTMLElement | null>(null);
  const open = (artifact: Artifact | null) => { opener.current = document.activeElement as HTMLElement; setModal({ artifact }); };
  useEffect(() => { if (modal) dialog.current?.showModal(); else { dialog.current?.close(); opener.current?.focus(); } }, [modal]);
  const send = (type: Action['type'], extra: Partial<Action> = {}) => dispatch({ type, run: s.run, phase: s.phase, version: s.version, ...extra });
  const action = (title: string, type: Action['type'], extra: Partial<Action> = {}, primary = false) => <button className={primary ? 'hf-primary' : ''} onClick={e => { if (e.detail < 2) send(type, extra); }}>{title}</button>;
  useEffect(() => { if (!isBusy(s.phase)) return; const t = setTimeout(() => dispatch({ type: 'finish', run: s.run, phase: s.phase, version: s.version }), 1000); return () => clearTimeout(t); }, [s.run, s.phase, s.version]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [s.entries.length, s.run]);
  const stage = !s.agreed ? 0 : !s.design ? 1 : s.phase === 'handed' ? 4 : s.phase === 'review' || s.phase === 'changes' || s.phase.startsWith('qa-') ? 3 : 2;
  const role: Person = s.phase === 'proposal' || s.phase === 'review' || s.phase.startsWith('ux-') ? 'jiyoon' : s.phase.startsWith('qa-') ? 'qa' : 'sang';
  let controls: ReactNode;
  if (s.phase === 'discussion') controls = <>{action('기존 로그인으로 돌아가죠', 'propose', { choice: 'login' })}{action('60초 안내 후 재발송하죠', 'propose', { choice: 'resend' }, true)}</>;
  else if (s.phase === 'proposal') controls = <>{action('이 안에 동의해요', 'agree-ux', {}, true)}{action('다른 경로도 비교해요', 'object')}{!s.privacy && action('이메일도 가려주세요', 'privacy')}</>;
  else if (s.phase === 'consent') controls = <>{action('구현 가능해요 · 합의', 'agree-dev', {}, true)}{action('지윤: 다시 논의해요', 'object')}</>;
  else if (s.phase === 'ux-ready') controls = action('내 UX Agent와 초안 만들기', 'start', {}, true);
  else if (s.phase === 'code-ready') controls = action(`내 Coding Agent와 ${s.version > 1 ? '수정하기' : '구현하기'}`, 'start', {}, true);
  else if (s.phase === 'qa-ready') controls = action('공유된 구현 기준 확인', 'start', {}, true);
  else if (isBusy(s.phase)) controls = <><span role="status">{s.phase === 'qa-running' ? '선택한 구현의 기준 대조 중' : '내 Agent의 로컬 결과 준비 중'}…</span>{action('진행 취소', 'cancel')}</>;
  else if (s.phase === 'ux-draft' || s.phase === 'code-draft') controls = <><button onClick={() => open(s.draft)}>공유 전 결과 보기 ↗</button>{action(s.phase === 'ux-draft' ? 'UX 초안을 팀에 공유' : `구현 v${s.version} 팀에 공유`, 'share', {}, true)}</>;
  else if (s.phase === 'changes') controls = action('QA 근거를 받아 보완하기', 'revise', {}, true);
  else if (s.phase === 'review') controls = <>{action('이 버전 승인 · 다음 일로', 'approve', {}, true)}{action('버튼 문구 수정 요청', 'reject')}</>;
  else controls = <span className="hf-complete">✓ 설명을 반복하지 않고, 다음 담당에게 이어졌어요.</span>;
  return <main className="hf" data-phase={s.phase}><header className="hf-header"><a href="/demo/design-to-code" aria-label="Ensemble 데모 홈"><img className="hf-logo" src={ensembleLogo.src} alt="Ensemble" /></a><span className="hf-tagline">함께 결정하고, 이어서 일하다.</span><div className="hf-controls"><button disabled={!s.past.length} onClick={() => send('back')} aria-label="이전 상태">←</button><button disabled={!s.future.length} onClick={() => send('forward')} aria-label="다음 상태">→</button><button onClick={() => { send('reset'); setModal(null); }}>처음부터</button><a href="/demo/pm-coordination">PM 조율 데모 ↗</a></div></header><div className="hf-demo"><span>INTERACTIVE DEMO</span> 선택에 따라 달라지는 로컬 시연 · 실제 모델/외부 연결 없음</div><div className="hf-layout">
    <aside className="hf-sidebar"><div className="hf-space"><img src={ensembleSymbol.src} alt="Ensemble 팀 심벌" /><div><b>Product team</b><small>사람 + 나의 Agent</small></div></div><div className="hf-channel"># 로그인 경험</div><span className="hf-eyebrow">함께하는 사람</span>{(['jiyoon', 'sang'] as const).map(w => <div className="hf-member" key={w}><Avatar who={w} /><div><b>{people[w].name}{w === 'sang' && <em>나</em>}</b><small>{people[w].role}</small></div></div>)}<span className="hf-eyebrow">팀을 잇는 Agent</span>{(['pm', 'ux', 'code', 'qa'] as const).map(w => <div className={`hf-member ${w}`} key={w}><Avatar who={w} /><div><b>{people[w].name}</b><small>{people[w].role}</small></div></div>)}<p className="hf-sidebar-note">개인 대화는 개인에게.<br />공유한 결과는 팀의 다음 일로.</p><p className="hf-photo-note">사진은 생성된 가상인물입니다.</p></aside>
    <section className="hf-chat" aria-label="팀 업무 대화"><div className="hf-chat-heading"><div><span className="hf-eyebrow"># 로그인 경험</span><h1>“오류가 났는데, 다음엔 뭘 하죠?”</h1></div><div className="hf-face-pile"><Avatar who="jiyoon" /><Avatar who="sang" /><Avatar who="pm" /></div></div><nav className="hf-progress" aria-label="협업 흐름">{['논의 · 합의', 'UX 초안', '구현', '근거 · 검토', '다음 일'].map((x, i) => <span key={x} className={stage === i ? 'active' : stage > i ? 'done' : ''}>{i < stage ? '✓' : i + 1} {x}</span>)}</nav><div className="hf-messages" role="log" aria-label="팀에 공유된 대화">{s.entries.map(e => <article key={`${s.run}-${e.id}`} id={`entry-${e.id}`} className={`hf-message ${e.speaker === 'sang' ? 'own' : ''} ${e.speaker === 'pm' ? 'pm' : ''}`}><Avatar who={e.speaker} /><div className="hf-message-body"><div className="hf-meta"><b>{people[e.speaker].name}</b><span>{e.speaker === 'pm' ? 'PM · 조율' : e.speaker === 'sang' ? '나' : people[e.speaker].role}</span></div><p className="hf-bubble">{e.text}</p><Card e={e} entries={s.entries} open={open} /></div></article>)}<div ref={end} /></div><div className="hf-composer"><div className="hf-composer-role"><Avatar who={role} /><span><b>{people[role].name} 역할로 참여</b><small>{s.phase.includes('draft') ? '개인 결과 · 공유 전에는 팀 상태에 반영되지 않아요' : s.phase.startsWith('code-') ? `입력: 지윤의 UX 초안 + 합의한 기준 → 구현 v${s.version}` : s.phase.startsWith('ux-') ? '내 UX Agent와 직접 작업 · 개인 대화는 비공개' : '예시 답장을 선택하면 대화와 작업 상태가 함께 바뀝니다'}</small></span></div>{s.phase === 'code-draft' && <label className="hf-check"><input type="checkbox" checked={!!s.draft?.focus} onChange={e => send('focus', { focus: e.target.checked })} />오류 후 복구 버튼으로 포커스 복귀 포함 <small>끄면 QA 보완 요청을 경험할 수 있어요</small></label>}{s.phase === 'review' && <div className="hf-review-note">현재 v{s.version} · QA 기준 확인. 최종 판단은 지윤에게 있어요.</div>}<div className="hf-actions">{controls}</div>{s.notice && <p role="status" className="hf-notice">{s.notice}</p>}</div></section>
    <aside className="hf-state" aria-label="팀 현재 상태"><span className="hf-eyebrow">TEAM WORK STATE</span><h2>실패해도, 다시 시작하게.</h2><div className="hf-current-label"><b>{s.shared ? label(s.shared) : '현재 화면'}</b><span>{s.shared ? '팀에 공유됨' : '아직 변경 없음'}</span></div><button className="hf-preview-open" onClick={() => open(s.shared)} aria-label="최신 팀 산출물 열기"><Preview key={`${s.shared?.version}-${s.shared?.choice}`} artifact={s.shared} /></button>{s.shared && <div className="hf-change-note">+ {s.shared.refined ? '버튼 문구 명확화' : '이유와 다음 행동'}{s.shared.privacy && ' · 주소 가리기'}{s.shared.focus && ' · 포커스 복귀'}</div>}{s.choice && <div className="hf-decision"><span>{s.agreed ? '합의한 방향' : '논의 중 · 미확정'}</span><b>{choices[s.choice].title}</b>{s.privacy && <small>추가 기준 · 이메일 가리기</small>}</div>}<Owners s={s} /><div className="hf-pm-next"><Avatar who="pm" /><div><span>PM의 다음 행동</span><b>{nextAction(s)}</b></div></div>{s.version > 1 && <details className="hf-stale"><summary>이전 v{s.version - 1} 결과 확인</summary><p>이전 결과로 현재 작업을 완료하지 않습니다.</p>{action('이전 결과 재공유 시도', 'share', { version: s.version - 1 })}{action('이전 검토 승인 시도', 'approve', { version: s.version - 1 })}</details>}<p className="hf-state-note">공유한 결과와 결정만 연결됩니다.<br />실제 Agent 실행·권한·영속 저장은 시연 범위 밖입니다.</p></aside></div>
    <dialog ref={dialog} className="hf-dialog" aria-label="로그인 복구 산출물" onCancel={() => setModal(null)}><header><div><span className="hf-eyebrow">ARTIFACT / LOGIN RECOVERY</span><h2>{modal?.artifact ? label(modal.artifact) : '개선 전 화면'}</h2></div><button onClick={() => setModal(null)} autoFocus>닫기</button></header>{modal && <Preview key={`${modal.artifact?.version}-${modal.artifact?.focus}-${modal.artifact?.choice}`} artifact={modal.artifact} interactive />}<p className="hf-dialog-note">로컬 미리보기입니다. 실제 로그인이나 메일 발송은 하지 않습니다.<br />QA 근거는 선택한 시연 상태를 대조한 예시입니다.</p></dialog>
  </main>;
}
