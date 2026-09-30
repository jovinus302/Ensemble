"use client";

import { useEffect, useRef, useState } from "react";
import { DecisionCard } from "./Cards";
import { Composer } from "./Composer";
import { formatDate } from "./format";
import { FreeStart } from "./FreeStart";
import { MessageItem } from "./Message";
import { PmLogPanel } from "./PmLog";
import { RoadmapCard } from "./Roadmap";
import { useViewModel } from "./use-view-model";

export function App() {
  const { vm, error, actions } = useViewModel();
  const [logOpen, setLogOpen] = useState(false);
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [freeForm, setFreeForm] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const messageCount = vm?.messages.length ?? 0;

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messageCount]);

  if (!vm) {
    return <main className="loading" role="status">{error ? `불러오지 못했어요: ${error}` : "불러오는 중…"}</main>;
  }

  const humans = vm.members.filter(m => m.kind === "human");
  const meMember = vm.members.find(m => m.id === vm.me);
  const needsStart = (vm.mode === "free" && !vm.project.goal) || freeForm;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Ensemble</div>
        <div className="project">
          <span className="project-goal">{vm.project.goal ?? "목표 미정"}</span>
          {vm.project.deadline && <span className="chip chip-plain num">기한 {formatDate(vm.project.deadline)}</span>}
        </div>
        <div className="topbar-controls">
          <div className="segmented" role="group" aria-label="모드">
            <button type="button" aria-pressed={vm.mode === "scenario" && !freeForm} onClick={() => { setFreeForm(false); void actions.startScenario("scene-1-3"); }}>시나리오</button>
            <button type="button" aria-pressed={vm.mode === "free" || freeForm} onClick={() => setFreeForm(true)}>자유형식</button>
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
      {error && <div role="alert" className="card">{error}</div>}

      {needsStart ? (
        <FreeStart
          onStart={async (goal, deadline) => { await actions.startFree(goal, deadline); setFreeForm(false); }}
          onCancel={vm.mode === "free" && !vm.project.goal ? undefined : () => setFreeForm(false)}
        />
      ) : (
        <div className="workspace">
          <aside className={`roadmap-card card${roadmapOpen ? " open" : ""}`} aria-label="로드맵">
            <button type="button" className="roadmap-toggle" aria-expanded={roadmapOpen} onClick={() => setRoadmapOpen(v => !v)}>
              <span>📌 로드맵</span>
              <span className="muted small">{roadmapOpen ? "접기" : "펼치기"}</span>
            </button>
            <h2 className="roadmap-heading">📌 로드맵</h2>
            <div className="roadmap-body">
              <RoadmapCard roadmap={vm.roadmap} deadline={vm.project.deadline} members={vm.members} me={vm.me} onSetAvailability={actions.setAvailability} />
            </div>
          </aside>

          <main className="channel">
            <div className="channel-head">
              <h1 className="channel-name"># 프로젝트</h1>
              <span className="muted small">{vm.members.length}명 · 사람 {humans.length} · Agent {vm.members.filter(m => m.kind === "agent").length}</span>
            </div>

            <div className="timeline" aria-live="polite">
              {vm.messages.map((m, i) => {
                const prev = vm.messages[i - 1];
                const grouped = !!prev && prev.authorId === m.authorId && prev.kind === m.kind && m.kind !== "system";
                return <MessageItem key={m.id} message={m} author={vm.members.find(x => x.id === m.authorId)} grouped={grouped} />;
              })}
              {vm.cards.map(c => <DecisionCard key={c.id} card={c} onDecide={actions.decideCard} />)}
              <div ref={endRef} />
            </div>

            {vm.mode === "scenario" && vm.scenario && (
              <div className="scenario-bar">
                {vm.scenario.done ? (
                  <span className="chip chip-done"><span aria-hidden>✓</span> 시나리오 끝</span>
                ) : (
                  <>
                    <div className="next-line">
                      <span className="muted small">다음 발언 · {vm.scenario.nextLine?.authorName ?? "—"}{vm.scenario.nextLine?.hasAttachment ? " · 📎 첨부" : ""}</span>
                      <span className="next-text">{vm.scenario.nextLine?.text ?? "남은 발언이 없어요"}</span>
                    </div>
                    <button type="button" className="btn-tonal" disabled={vm.busy || !vm.scenario.nextLine} onClick={() => void actions.scenarioNext()}>다음 발언</button>
                  </>
                )}
              </div>
            )}

            <Composer busy={vm.busy} meName={meMember?.displayName ?? vm.me} onSend={actions.sendMessage} />
          </main>
        </div>
      )}

      {logOpen && <PmLogPanel log={vm.pmLog} messages={vm.messages} members={vm.members} onClose={() => setLogOpen(false)} />}
    </div>
  );
}
