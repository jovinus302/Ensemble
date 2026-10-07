'use client';
import { useRef, useState } from 'react';
import { useViewModel } from '../../apps/web/components/use-view-model';
import type { VmCard, VmDecisionCard } from '../../apps/web/lib/view-model';
import { DecisionCard } from '../../apps/web/components/Cards';
import './workspaces.css';

const statuses: Record<string, string> = { todo: '대기', in_progress: '진행 중', in_review: '검토 중', waiting_human: '사람 확인 대기', blocked: '막힘', done: '완료', cancelled: '취소' };
export function WorkspaceDemo() {
  const { vm, error, connectionLost, pending, actions } = useViewModel({ allowMock: false });
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('');
  const submitting = useRef(false);
  const items = vm?.work?.items ?? [];
  const cards = [...new Map<string, VmCard | VmDecisionCard>([...(vm?.cards ?? []), ...(vm?.decisionCards ?? [])].map(c => [c.id, c])).values()];
  const artifacts = [...new Map((vm?.messages ?? []).flatMap(m => m.attachments).map(a => [a.id, a])).values()];
  const decisions = [...new Map(items.flatMap(t => t.brief?.decisions ?? []).map(d => [d.id, d])).values()];
  const pm = vm?.messages.filter(m => m.kind === 'pm').at(-1);
  const empty = !vm?.project.goal || vm.project.goal === '새 프로젝트';
  const live = vm?.connection?.worker === 'codex' || vm?.connection?.worker === 'claude';
  async function submit() {
    if (!input.trim() || submitting.current) return;
    submitting.current = true;
    setNotice('');
    try {
      const result = empty ? await actions.startFree(input.trim()) : await actions.sendMessage(input.trim(), []);
      if (result.ok) setInput(''); else setNotice(result.message);
    } finally { submitting.current = false; }
  }
  return <div className="pm-dashboard">
    <header className="pd-header"><a href="/demo" className="pd-brand"><span aria-hidden="true">e</span>ensemble</a><span className="pd-product">PM Agent</span><span className="pd-demo">CLI feasibility</span></header>
    <main className="pd-main">
      {(error || notice || connectionLost) && <p role="alert">{notice || error || '연결이 끊겼습니다. 표시된 내용은 마지막으로 받은 상태입니다.'}</p>}
      {!vm ? <p role="status">프로젝트를 불러오는 중입니다.</p> : <>
        <div className="pd-heading"><div><p className="pd-eyebrow">PROJECT OVERVIEW</p><h1>{empty ? '프로젝트 시작' : vm.project.title || vm.project.goal}</h1><p>{empty ? '목표를 입력하면 PM Agent가 기존 실행 연결을 통해 작업을 조율합니다.' : vm.project.goal}</p></div><span className="pd-status">{vm.activity?.kind === 'agent_working' ? 'Agent 작업 중' : vm.busy ? '처리 중' : '현재 기록'}</span></div>
        <p className="pd-note">실행 설정 · PM Agent: {vm.connection?.pm ?? '확인 불가'} · 작업 Agent: {vm.connection?.worker ?? '확인 불가'}. 설정 표시는 실행 성공을 의미하지 않습니다.</p>
        {(!live || vm.project.synthetic) && <p role="status">{vm.project.synthetic ? '기존 시나리오 기록입니다. 실제 외부 작업 결과로 해석하지 마세요.' : '현재 작업 Agent는 실제 CLI 연결이 아닙니다. CLI 설정 후 서버를 다시 시작하세요.'}</p>}
        <div className="pd-summary"><div className="pd-avatar" aria-hidden="true">PM</div><div><h2>PM Agent의 현재 판단</h2><p>{pm?.text ?? '아직 기록된 판단이 없습니다.'}</p>{vm.activity?.kind !== 'idle' && <p>{vm.activity?.label}</p>}{vm.activity?.stalled && <p>{vm.activity.stalled.reason}</p>}</div></div>
        <form className="pd-input" onSubmit={e => { e.preventDefault(); void submit(); }}><label htmlFor="pm-input">{empty ? '프로젝트 목표' : 'PM Agent에게 변경사항 전달'}</label><textarea id="pm-input" value={input} onChange={e => setInput(e.target.value)} required disabled={pending} /><button disabled={pending || vm.busy || !input.trim()}>{pending ? '전달 중' : empty ? '계획 요청' : '전달'}</button></form>
        <div className="pd-metrics"><div><span>작업</span><strong>{items.length}</strong></div><div><span>결정 요청</span><strong>{cards.length}</strong></div><div><span>산출물</span><strong>{artifacts.length}</strong></div><div><span>완료</span><strong>{items.filter(t => t.status === 'done').length}</strong></div></div>
        <div className="pd-grid">
          <section className="pd-panel"><h2>작업과 담당</h2>{!items.length && <p>아직 등록된 작업이 없습니다.</p>}{items.map(t => <article className="pd-task" key={t.id}><div className="pd-task-body"><div className="pd-task-title"><h3>{t.title}</h3><span>{statuses[t.status] ?? t.status}</span></div><p>{vm.members.find(m => m.id === t.ownerId)?.displayName ?? t.ownerId}</p>{t.brief?.why && <p>{t.brief.why}</p>}{!!t.brief?.sources.length && <details><summary>근거 기록</summary>{t.brief.sources.map(s => <p key={s.messageId}>{s.excerpt}</p>)}</details>}</div></article>)}</section>
          <section className="pd-panel"><h2>다음 행동 · 결정 요청</h2>{!cards.length && !vm.roadmap.blocked.length && <p>현재 요청된 결정이나 기록된 막힘이 없습니다.</p>}{cards.map(card => <DecisionCard key={card.id} card={card} members={vm.members} onDecide={actions.decideCard} onDecideRequest={actions.decide} />)}{vm.roadmap.blocked.map(b => <p key={b.taskId}>{items.find(t => t.id === b.taskId)?.title ?? b.taskId}: {b.reason}</p>)}</section>
          <section className="pd-panel"><h2>결정과 이유</h2>{!decisions.length && <p>아직 연결된 결정이 없습니다.</p>}{decisions.map(d => <p key={d.id}>{d.summary}</p>)}{vm.roadmap.lastChange && <p>계획 변경: {vm.roadmap.lastChange.reason}</p>}</section>
          <section className="pd-panel"><h2>산출물</h2>{!artifacts.length && <p>아직 공유된 산출물이 없습니다.</p>}{artifacts.map(a => <a className="pd-artifact" key={a.id} href={a.url} target="_blank" rel="noreferrer">{a.name} ↗</a>)}</section>
        </div>
      </>}
      <footer>기존 실행 기록을 보여주는 보조 대시보드입니다. 디자인·Slack·미팅 연동은 후속 검증 대상입니다.</footer>
    </main>
  </div>;
}
