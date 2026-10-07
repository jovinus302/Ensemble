"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildMockViewModel, mockTaskDetail } from "../lib/mock-view-model";
import type { DecisionAnswer, ViewModel, VmMessage, VmTaskDetail } from "../lib/view-model";
import { koreanOr } from "./format";

// 서버 경로는 여기 한 곳에만 둔다. 시나리오 재시도·건너뛰기 경로는 서버(W-S)가 확정하면 이 값만 바꾼다.
export const API = {
  state: (me: string) => `/api/state?me=${encodeURIComponent(me)}`,
  events: "/api/events",
  messages: "/api/messages",
  availability: "/api/availability",
  card: (id: string) => `/api/cards/${encodeURIComponent(id)}`,
  decision: (id: string) => `/api/decisions/${encodeURIComponent(id)}`,
  task: (id: string) => `/api/tasks/${encodeURIComponent(id)}`,
  taskComments: (id: string) => `/api/tasks/${encodeURIComponent(id)}/comments`,
  resolve: (id: string) => `/api/tasks/${encodeURIComponent(id)}/resolve`,
  freeStart: "/api/free/start",
  scenarioStart: "/api/scenario/start",
  scenarioNext: "/api/scenario/next",
  scenarioRetry: "/api/scenario/retry",
  scenarioSkip: "/api/scenario/skip",
} as const;

const ME_KEY = "ensemble.me";
const NETWORK_ERROR = "서버에 연결하지 못했어요. 연결이 돌아오면 다시 시도해 주세요.";
const GENERIC_ERROR = "요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
/** 이벤트 스트림이 이 시간 넘게 끊겨 있어야 끊김으로 표시한다(순간 재연결은 숨김). */
const LOST_AFTER_MS = 1500;

export type ActionResult = { ok: true } | { ok: false; code?: string; message: string };
export type DecisionInput = Omit<DecisionAnswer, "me">;
export type LoadTaskResult = { ok: true; detail: VmTaskDetail } | { ok: false; code?: string; message: string };

export interface ViewModelActions {
  resolveTask(taskId: string, action: 'accept' | 'retry' | 'recheck', note?: string): Promise<ActionResult>;
  /** 즉시 "보내는 중"으로 보이고, 이전 전송이 끝난 뒤 순서대로 서버에 보낸다. */
  sendMessage(text: string, files: File[]): Promise<ActionResult>;
  decideCard(cardId: string, approve: boolean): Promise<ActionResult>;
  /** 결정 요청 카드에 답한다(`POST decisions/:id`). */
  decide(requestId: string, answer: DecisionInput): Promise<ActionResult>;
  /** 작업 댓글(`POST tasks/:id/comments`). 서버가 threadId "task:<id>" 메시지로 기록한다. */
  comment(taskId: string, text: string): Promise<ActionResult>;
  /** 작업 상세(`GET tasks/:id`): 활동 기록·댓글은 상태 폴링에 싣지 않아 따로 가져온다. */
  loadTask(taskId: string): Promise<LoadTaskResult>;
  setAvailability(memberId: string, weeklyHours: number): Promise<ActionResult>;
  scenarioNext(): Promise<ActionResult>;
  scenarioRetry(): Promise<ActionResult>;
  scenarioSkip(): Promise<ActionResult>;
  /** confirmReplace 없이 진행 중 프로젝트가 있으면 code "project_exists"로 실패한다(오류 배너 없이). */
  startFree(goal: string, deadline?: string, confirmReplace?: boolean): Promise<ActionResult>;
  startScenario(name: string, confirmReplace?: boolean): Promise<ActionResult>;
  switchMe(memberId: string): void;
  dismissError(): void;
}
/** pending: 이 탭이 보낸 요청이 아직 서버 상태에 반영되지 않음(버튼을 disabled로 막는 근거). */
export interface UseViewModelResult { vm: ViewModel | null; error: string | null; connectionLost: boolean; pending: boolean; actions: ViewModelActions }

interface OutboxItem { localId: string; authorId: string; text: string; fileNames: string[]; at: string; messageId?: string }

function fileContent(file: File): Promise<{ name: string; mimeType: string; contentBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mimeType: file.type || "application/octet-stream", contentBase64: String(reader.result).split(",")[1] ?? "" });
    reader.onerror = () => reject(new Error("첨부 파일을 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}

/** 오류 응답(계약 4 `{ error: { code, message } }`과 예전 `{ error: string }`)을 한국어 문구로. */
export function readError(data: unknown): { code?: string; message: string } {
  const error = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  if (error && typeof error === "object") {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return { ...(typeof code === "string" ? { code } : {}), message: koreanOr(message, GENERIC_ERROR) };
  }
  return { message: koreanOr(error, GENERIC_ERROR) };
}

function isViewModel(data: unknown): data is ViewModel {
  return !!data && typeof data === "object" && Array.isArray((data as ViewModel).messages) && Array.isArray((data as ViewModel).members);
}

type CallResult = { ok: true; data: unknown } | { ok: false; code?: string; message: string };
async function call(url: string, body: object): Promise<CallResult> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, code: "network", message: NETWORK_ERROR };
  }
  let data: unknown = null;
  try { data = await response.json(); } catch { /* 본문 없는 응답 */ }
  return response.ok ? { ok: true, data } : { ok: false, ...readError(data) };
}

/** 주소에 `?mock`이 있으면 서버 없이 목업 뷰 모델로 그린다(화면 확인용). 결정·댓글은 이 탭 안에서만 반영된다. */
function readMockFlag(): boolean {
  try { return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock"); } catch { return false; }
}
interface MockState { decided: string[]; comments: Record<string, VmMessage[]> }
const MOCK_ONLY = "목업 화면에서는 서버로 보내지 않아요.";

function readStoredMe(): string {
  try { return (typeof window !== "undefined" && window.localStorage.getItem(ME_KEY)) || "owner"; } catch { return "owner"; }
}

export function useViewModel(options: { allowMock?: boolean } = {}): UseViewModelResult {
  const [me, setMe] = useState(readStoredMe);
  const [mock] = useState(() => options.allowMock !== false && readMockFlag());
  const [mockState, setMockState] = useState<MockState>({ decided: [], comments: {} });
  const [vm, setVm] = useState<ViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [streamDown, setStreamDown] = useState(false);
  const [fetchDown, setFetchDown] = useState(false);
  const [offline, setOffline] = useState(false);
  const currentMe = useRef(me);
  currentMe.current = me;
  const revision = useRef(0);
  const sendQueue = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    let response: Response;
    try {
      response = await fetch(API.state(me), { cache: "no-store" });
    } catch {
      if (currentMe.current === me) setFetchDown(true);
      return;
    }
    if (currentMe.current !== me) return;
    setFetchDown(false);
    try {
      if (!response.ok) throw new Error();
      const next = await response.json() as ViewModel;
      if (request === revision.current && currentMe.current === me) setVm(next);
    } catch { if (currentMe.current === me) setError("상태를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요."); }
  }, [me]);

  useEffect(() => {
    const online = () => { setOffline(false); void refresh(); };
    const offline = () => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [refresh]);

  useEffect(() => {
    if (!mock) return;
    const base = buildMockViewModel(me);
    const decided = new Set(mockState.decided);
    setVm({ ...base, decisionCards: base.decisionCards?.filter(c => !decided.has(c.id)) });
  }, [mock, me, mockState]);

  useEffect(() => {
    if (mock) return;
    let events: EventSource | null = null;
    let polling: ReturnType<typeof setInterval> | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    let lost: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const open = () => {
      const source = new EventSource(API.events);
      events = source;
      source.addEventListener("changed", () => { void refresh(); });
      source.onopen = () => {
        clearTimeout(lost); lost = undefined; setStreamDown(false);
        void refresh();
        if (polling) clearInterval(polling);
        polling = undefined;
      };
      source.onerror = () => {
        lost ??= setTimeout(() => setStreamDown(true), LOST_AFTER_MS);
        polling ??= setInterval(() => { void refresh(); }, 3000);
        // 서버가 오류로 응답하면 브라우저는 다시 연결하지 않으므로 직접 다시 연다.
        if (source.readyState === EventSource.CLOSED && !closed) { source.close(); reopen = setTimeout(open, 3000); }
      };
    };
    void refresh();
    open();
    return () => { closed = true; events?.close(); clearTimeout(reopen); clearTimeout(lost); if (polling) clearInterval(polling); revision.current++; };
  }, [refresh, mock]);

  // 서버 기록에 나타난 내 메시지는 "보내는 중" 목록에서 뺀다.
  useEffect(() => {
    if (!vm) return;
    const recorded = new Set(vm.messages.map(m => m.id));
    setOutbox(items => items.some(x => x.messageId && recorded.has(x.messageId)) ? items.filter(x => !x.messageId || !recorded.has(x.messageId)) : items);
  }, [vm]);

  // 202처럼 상태가 없는 응답이면 새 상태를 받아 온 뒤에 끝낸다. 그 사이에 버튼이 다시 눌리지 않게 한다.
  const accept = useCallback(async (data: unknown) => {
    if (isViewModel(data) && currentMe.current === me) { revision.current++; setVm(data); } else await refresh();
  }, [me, refresh]);

  const post = useCallback(async (url: string, body: object, quiet: string[] = []): Promise<ActionResult> => {
    if (mock) { setError(MOCK_ONLY); return { ok: false, code: "mock", message: MOCK_ONLY }; }
    setPending(true); setError(null);
    try {
      const result = await call(url, { ...body, me });
      if (result.ok) { await accept(result.data); return { ok: true }; }
      if (!result.code || !quiet.includes(result.code)) setError(result.message);
      void refresh();
      return result;
    } finally { setPending(false); }
  }, [me, accept, refresh, mock]);

  const loadTask = useCallback(async (taskId: string): Promise<LoadTaskResult> => {
    if (mock) {
      const detail = mockTaskDetail(taskId);
      if (!detail) return { ok: false, code: "task_not_found", message: "작업을 찾지 못했어요." };
      return { ok: true, detail: { ...detail, comments: [...detail.comments, ...(mockState.comments[taskId] ?? [])] } };
    }
    let response: Response;
    try { response = await fetch(API.task(taskId), { cache: "no-store" }); } catch { return { ok: false, code: "network", message: NETWORK_ERROR }; }
    let data: unknown = null;
    try { data = await response.json(); } catch { /* 본문 없는 응답 */ }
    if (!response.ok) return { ok: false, ...readError(data) };
    const detail = data as VmTaskDetail | null;
    return detail && typeof detail === "object" && detail.item && Array.isArray(detail.activity) && Array.isArray(detail.comments)
      ? { ok: true, detail } : { ok: false, message: GENERIC_ERROR };
  }, [mock, mockState]);

  const actions = useMemo<ViewModelActions>(() => ({
    resolveTask: (id, action, note) => post(API.resolve(id), { action, note }),
    sendMessage: (text, files) => {
      if (mock) { setError(MOCK_ONLY); return Promise.resolve({ ok: false, code: "mock", message: MOCK_ONLY }); }
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setOutbox(items => [...items, { localId, authorId: me, text, fileNames: files.map(f => f.name), at: new Date().toISOString() }]);
      setError(null);
      const drop = () => setOutbox(items => items.filter(x => x.localId !== localId));
      const run = async (): Promise<ActionResult> => {
        let attachments: Awaited<ReturnType<typeof fileContent>>[];
        try { attachments = await Promise.all(files.map(fileContent)); } catch {
          drop(); setError("첨부 파일을 읽지 못했어요.");
          return { ok: false, message: "첨부 파일을 읽지 못했어요." };
        }
        const result = await call(API.messages, { authorId: me, text, attachments, me });
        if (!result.ok) { drop(); setError(result.message); void refresh(); return result; }
        const messageId = result.data && typeof result.data === "object" ? (result.data as { messageId?: unknown }).messageId : undefined;
        // 계약 1(202 + messageId): 기록된 메시지가 상태에 나타날 때까지 "보내는 중"을 유지한다.
        if (typeof messageId === "string") { setOutbox(items => items.map(x => x.localId === localId ? { ...x, messageId } : x)); void refresh(); }
        else { drop(); void accept(result.data); }
        return { ok: true };
      };
      const next = sendQueue.current.then(run, run);
      sendQueue.current = next.catch(() => undefined);
      return next;
    },
    decideCard: (id, approve) => post(API.card(id), { memberId: me, approve }),
    decide: async (id, answer) => {
      if (mock) { setMockState(s => ({ ...s, decided: [...s.decided, id] })); return { ok: true }; }
      return post(API.decision(id), answer);
    },
    comment: async (taskId, text) => {
      if (mock) {
        const message: VmMessage = { id: `mock-${Date.now()}`, authorId: me, kind: "human", text, at: new Date().toISOString(), threadId: `task:${taskId}`, attachments: [] };
        setMockState(s => ({ ...s, comments: { ...s.comments, [taskId]: [...(s.comments[taskId] ?? []), message] } }));
        return { ok: true };
      }
      return post(API.taskComments(taskId), { text });
    },
    loadTask,
    setAvailability: (memberId, weeklyHours) => post(API.availability, { memberId, weeklyHours }),
    scenarioNext: () => post(API.scenarioNext, {}),
    scenarioRetry: () => post(API.scenarioRetry, {}),
    scenarioSkip: () => post(API.scenarioSkip, {}),
    startFree: (goal, deadline, confirmReplace) => post(API.freeStart, { goal, deadline, ...(confirmReplace ? { confirmReplace: true } : {}) }, ["project_exists"]),
    startScenario: (name, confirmReplace) => post(API.scenarioStart, { name, ...(confirmReplace ? { confirmReplace: true } : {}) }, ["project_exists"]),
    switchMe: memberId => {
      setMe(memberId); setError(null);
      try { window.localStorage.setItem(ME_KEY, memberId); } catch { /* 저장소를 못 쓰면 이번 탭에서만 유지 */ }
    },
    dismissError: () => setError(null),
  }), [me, post, accept, refresh, mock, loadTask]);

  const merged = useMemo(() => {
    if (!vm) return null;
    const recorded = new Set(vm.messages.map(m => m.id));
    const sending: VmMessage[] = outbox.filter(x => !x.messageId || !recorded.has(x.messageId)).map(x => ({
      id: x.localId, authorId: x.authorId, kind: "human", text: x.text, at: x.at, local: "sending",
      attachments: x.fileNames.map((name, i) => ({ id: `${x.localId}-${i}`, name, url: "" })),
    }));
    return { ...vm, busy: vm.busy || pending, messages: sending.length ? [...vm.messages, ...sending] : vm.messages };
  }, [vm, outbox, pending]);

  return { vm: merged, error, connectionLost: offline || streamDown || fetchDown, pending, actions };
}
