"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VmCard, VmDecisionCard } from "../lib/view-model";
import { ActivityLine } from "./Activity";
import { Archives } from "./Archives";
import { DecisionCard } from "./Cards";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatDate, sceneLabel } from "./format";
import { FreeStart } from "./FreeStart";
import { MemberList } from "./Members";
import { MessageItem } from "./Message";
import { PmLogPanel } from "./PmLog";
import { useViewModel } from "./use-view-model";
import { WorkItemDetail } from "./WorkItemDetail";
import { WorkPanel, type PanelTab } from "./WorkPanel";
import { decisionTotal, stallGuidance } from "./work-view";

const REPLACE_WARNING = "진행 중인 프로젝트는 보관되고 화면에서 사라집니다.";
type Pending = { kind: "scenario" } | { kind: "free"; goal: string; deadline?: string };
/** 좁은 화면의 탭. 넓은 화면은 채널과 작업 패널을 함께 보이므로 이 값은 CSS가 좁은 화면에서만 쓴다. */
type MobileView = "channel" | "work" | "decisions";

export function App() {
  const { vm, error, connectionLost, pending, actions } = useViewModel();
  const [logOpen, setLogOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("work");
  const [mobileView, setMobileView] = useState<MobileView>("channel");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const [freeForm, setFreeForm] = useState(false);
  const [confirm, setConfirm] = useState<{ action: Pending; message: string } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [stepping, setStepping] = useState(false);
  const stepFlight = useRef(false);
  const replaceFlight = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const messageCount = vm?.messages.length ?? 0;

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messageCount]);
  // 작업 상세의 "이 대화에서 생김": 서랍을 닫고 채널로 돌아가 그 메시지로 이동해 잠깐 강조한다.
  useEffect(() => {
    if (!jumpTo) return;
    const el = document.getElementById(`msg-${jumpTo}`);
    if (!el) { setJumpTo(null); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("msg-highlight");
    const timer = setTimeout(() => setJumpTo(null), 2000);
    return () => { clearTimeout(timer); el.classList.remove("msg-highlight"); };
  }, [jumpTo]);
  const closeTask = useCallback(() => setOpenTask(null), []);
  const jumpToMessage = useCallback((messageId: string) => { setOpenTask(null); setMobileView("channel"); setJumpTo(messageId); }, []);

  if (!vm) {
    return (
      <main className="loading" role="status">
        {connectionLost ? "서버에 연결하지 못했어요. 다시 연결 중…" : error ? `불러오지 못했어요: ${error}` : "불러오는 중…"}
      </main>
    );
  }

  const humans = vm.members.filter(m => m.kind === "human");
  const meMember = vm.members.find(m => m.id === vm.me);
  const needsStart = (vm.mode === "free" && !vm.project.goal) || freeForm;
  // 서버가 최종 판단(409 project_exists)하지만, 지울 것이 보이면 먼저 묻는다.
  const hasProject = vm.messages.some(m => !m.local) || vm.roadmap.planVersion !== null || vm.cards.length > 0;

  /** 전환을 실행한다. 서버가 진행 중 프로젝트를 알려 오면 확인 대화상자를 연다. */
  const run = async (action: Pending, confirmReplace: boolean) => {
    const result = action.kind === "scenario"
      ? await actions.startScenario("scene-1-3", confirmReplace)
      : await actions.startFree(action.goal, action.deadline, confirmReplace);
    if (!result.ok && result.code === "project_exists" && !confirmReplace) { setConfirm({ action, message: result.message }); return; }
    if (result.ok && action.kind === "free") setFreeForm(false);
  };
  const request = async (action: Pending) => {
    if (hasProject) setConfirm({ action, message: REPLACE_WARNING });
    else await run(action, false);
  };
  // "다음 발언"은 서버 activity로 막는다(서버는 202로 즉시 답하고 진행은 activity로 알린다). 막을 때는 이유를 함께 보인다.
  const activity = vm.activity;
  const stepBlocked: { label: string; reason: string } | null =
    stepping ? { label: "진행 중…", reason: "요청을 보내는 중이에요." }
    : activity?.stalled ? { label: "멈춤", reason: stallGuidance(activity.stalled, true) }
    : activity && (activity.kind === "pm_thinking" || activity.kind === "scenario_waiting") ? { label: "진행 중…", reason: `${activity.label} — 끝나면 다음 발언을 보낼 수 있어요.` }
    : !activity && vm.busy ? { label: "진행 중…", reason: "PM·Agent가 처리 중이에요." }
    : null;
  const stepNext = async () => {
    if (stepFlight.current) return;
    stepFlight.current = true;
    setStepping(true);
    try { await actions.scenarioNext(); } finally { stepFlight.current = false; setStepping(false); }
  };
  // 카드가 보이는 사람에게는 카드를 안내하는 PM 발언 대신 카드를 그 자리에 둔다(같은 내용을 두 번 보이지 않게).
  const visibleCards = new Map<string, VmCard | VmDecisionCard>([...vm.cards, ...(vm.decisionCards ?? [])].map(c => [c.id, c]));
  const linkedCards = new Set(vm.messages.flatMap(m => (m.cardId && visibleCards.has(m.cardId) ? [m.cardId] : [])));
  const workTitles = new Map((vm.work?.items ?? []).map(i => [i.id, i.title]));
  const decisionCount = decisionTotal([...(vm.decisionCards ?? []), ...vm.cards]);
  const showMobile = (view: MobileView) => {
    setMobileView(view);
    if (view === "decisions") setPanelTab("decisions");
    else if (view === "work" && panelTab === "decisions") setPanelTab("work");
  };
  const confirmReplace = async () => {
    if (!confirm || replaceFlight.current) return;
    replaceFlight.current = true;
    setConfirmPending(true);
    try { await run(confirm.action, true); } finally { replaceFlight.current = false; setConfirmPending(false); setConfirm(null); }
  };

  return (
    <div className="app">
      {archiveOpen && <Archives onClose={() => setArchiveOpen(false)} />}
      <div className="active-project" hidden={archiveOpen}>
      <header className="topbar">
        <div className="brand">Ensemble</div>
        <a href="/demo/pm-coordination" className="btn-tonal">PM 조율 데모</a>
        <div className="project">
          <span className="project-goal" title={vm.project.goal}>{vm.project.title ?? vm.project.goal ?? "목표 미정"}</span>
          {vm.project.synthetic && <span className="badge badge-demo" title="시연용 가상 자료입니다">시연용</span>}
          {vm.project.deadline && <span className="chip chip-plain num">기한 {formatDate(vm.project.deadline)}</span>}
        </div>
        <button className="btn-tonal controls-toggle" aria-expanded={controlsOpen} aria-controls="topbar-controls" onClick={() => setControlsOpen(v => !v)}>메뉴</button>
        <div id="topbar-controls" className={`topbar-controls${controlsOpen ? ' expanded' : ''}`}>
          <button type="button" className="btn-tonal" onClick={() => setArchiveOpen(true)}>보관함</button>
          <div className="segmented" role="group" aria-label="모드">
            <button type="button" aria-pressed={vm.mode === "scenario" && !freeForm} disabled={pending} title={pending ? "요청을 처리하는 중이에요" : undefined} onClick={() => { setFreeForm(false); void request({ kind: "scenario" }); }}>시나리오</button>
            <button type="button" aria-pressed={vm.mode === "free" || freeForm} disabled={pending} title={pending ? "요청을 처리하는 중이에요" : undefined} onClick={() => setFreeForm(true)}>자유형식</button>
          </div>
          <label className="me-select">
            <span className="muted small">나</span>
            <select value={vm.me} onChange={e => actions.switchMe(e.target.value)} aria-label="현재 사용자">
              {humans.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </select>
          </label>
          <button type="button" className="btn-tonal" aria-pressed={logOpen} onClick={() => setLogOpen(v => !v)}>PM 판단 기록</button>
        </div>
      </header>
      {connectionLost && <div className="banner banner-offline" role="status"><span className="shimmer" aria-hidden /> 연결이 끊겼습니다. 다시 연결 중…</div>}
      {error && (
        <div role="alert" className="banner banner-error">
          <span>{error}</span>
          <button type="button" className="icon-btn icon-btn-small" aria-label="오류 닫기" onClick={actions.dismissError}>×</button>
        </div>
      )}

      {needsStart ? (
        <FreeStart
          onStart={(goal, deadline) => request({ kind: "free", goal, deadline })}
          onCancel={vm.mode === "free" && !vm.project.goal ? undefined : () => setFreeForm(false)}
        />
      ) : (
        <>
        <nav className="mobile-tabs" aria-label="보기">
          {([["channel", "채널"], ["work", "작업"], ["decisions", "내 결정"]] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={mobileView === key} onClick={() => showMobile(key)}>
              {label}{key === "decisions" && decisionCount > 0 && <span className="tab-count num">{decisionCount}</span>}
            </button>
          ))}
        </nav>
        <div className="workspace" data-view={mobileView === "channel" ? "channel" : "panel"}>
          <WorkPanel vm={vm} tab={panelTab} onTab={t => { setPanelTab(t); if (mobileView !== "channel") setMobileView(t === "decisions" ? "decisions" : "work"); }}
            onOpenTask={setOpenTask} onDecide={actions.decideCard} onDecideRequest={actions.decide}
            onSetAvailability={actions.setAvailability} onResolve={actions.resolveTask} onConfirmLink={actions.confirmParticipantLink} />

          <main className="channel">
            <div className="channel-head">
              <h1 className="channel-name"># 프로젝트</h1>
              <MemberList members={vm.members} me={vm.me} />
            </div>

            <div className="timeline" aria-live="polite">
              {vm.messages.map((m, i) => {
                if (m.cardId && linkedCards.has(m.cardId)) return <DecisionCard key={m.id} card={visibleCards.get(m.cardId)!} members={vm.members} onDecide={actions.decideCard} onDecideRequest={actions.decide} />;
                const prev = vm.messages[i - 1];
                const grouped = !!prev && !(prev.cardId && linkedCards.has(prev.cardId)) && prev.authorId === m.authorId && prev.kind === m.kind && m.kind !== "system" && !prev.local === !m.local;
                return <MessageItem key={m.id} message={m} author={vm.members.find(x => x.id === m.authorId)} grouped={grouped} workTitles={workTitles} onOpenTask={setOpenTask} />;
              })}
              {vm.cards.filter(c => !linkedCards.has(c.id)).map(c => <DecisionCard key={c.id} card={c} onDecide={actions.decideCard} />)}
              {(vm.decisionCards ?? []).filter(c => !linkedCards.has(c.id)).map(c => <DecisionCard key={c.id} card={c} members={vm.members} onDecide={actions.decideCard} onDecideRequest={actions.decide} />)}
              <div ref={endRef} />
            </div>

            {vm.mode === "scenario" && vm.scenario && (
              <div className="scenario-bar">
                {vm.scenario.done ? (
                  <span className="chip chip-done"><span aria-hidden>✓</span> 시나리오 끝</span>
                ) : (
                  <>
                    <div className="next-line">
                      <span className="muted small">{sceneLabel(vm.scenario.name)} · 다음 발언 · {vm.scenario.nextLine?.authorName ?? "—"}{vm.scenario.nextLine?.hasAttachment ? " · 📎 첨부" : ""}</span>
                      <span className="next-text" title={vm.scenario.nextLine?.text}>{vm.scenario.nextLine?.text ?? "남은 발언이 없어요"}</span>
                    </div>
                    <div className="next-action">
                      <button type="button" className="btn-tonal" disabled={!!stepBlocked || !vm.scenario.nextLine} aria-describedby={stepBlocked ? "next-reason" : undefined} onClick={event => { if (event.detail < 2) void stepNext(); }}>
                        {stepBlocked?.label ?? "다음 발언"}
                      </button>
                      {stepBlocked && <span id="next-reason" className="next-reason">{stepBlocked.reason}</span>}
                    </div>
                  </>
                )}
              </div>
            )}

            <ActivityLine activity={vm.activity} busy={vm.busy} onRetry={actions.scenarioRetry} onSkip={actions.scenarioSkip} onResolve={actions.resolveTask} />
            <Composer meName={meMember?.displayName ?? vm.me} onSend={actions.sendMessage} />
          </main>
        </div>
        </>
      )}

      {openTask && (
        <WorkItemDetail taskId={openTask} items={vm.work?.items ?? []} members={vm.members} me={vm.me} messages={vm.messages} refreshKey={vm}
          onClose={closeTask} onLoad={actions.loadTask} onComment={actions.comment} onOpenTask={setOpenTask}
          onJumpToMessage={jumpToMessage} onResolve={actions.resolveTask} />
      )}

      {logOpen && <PmLogPanel log={vm.pmLog} messages={vm.messages} members={vm.members} onClose={() => setLogOpen(false)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.action.kind === "scenario" ? "시나리오를 시작할까요?" : "새 프로젝트를 시작할까요?"}
          message={confirm.message}
          confirmLabel="보관하고 시작"
          pending={confirmPending}
          onConfirm={() => void confirmReplace()}
          onCancel={() => setConfirm(null)}
        />
      )}
      </div>
    </div>
  );
}
