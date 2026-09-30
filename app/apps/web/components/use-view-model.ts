"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewModel } from "../lib/view-model";

export interface ViewModelActions {
  sendMessage(text: string, files: File[]): Promise<void>;
  decideCard(cardId: string, approve: boolean): Promise<void>;
  setAvailability(memberId: string, weeklyHours: number): Promise<void>;
  scenarioNext(): Promise<void>;
  startFree(goal: string, deadline?: string): Promise<void>;
  startScenario(name: string): Promise<void>;
  switchMe(memberId: string): void;
}
export interface UseViewModelResult { vm: ViewModel | null; error: string | null; actions: ViewModelActions }

function fileContent(file: File): Promise<{ name: string; mimeType: string; contentBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mimeType: file.type || "application/octet-stream", contentBase64: String(reader.result).split(",")[1] ?? "" });
    reader.onerror = () => reject(new Error("첨부 파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}
export function useViewModel(): UseViewModelResult {
  const [me, setMe] = useState("owner");
  const [vm, setVm] = useState<ViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const currentMe = useRef(me);
  currentMe.current = me;
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const response = await fetch(`/api/state?me=${encodeURIComponent(me)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("상태를 불러오지 못했습니다.");
      const next = await response.json() as ViewModel;
      if (request === revision.current && currentMe.current === me) setVm(next);
    } catch (e) { if (currentMe.current === me) setError(e instanceof Error ? e.message : "연결을 확인해 주세요."); }
  }, [me]);
  useEffect(() => {
    void refresh();
    const events = new EventSource("/api/events");
    let polling: ReturnType<typeof setInterval> | undefined;
    events.addEventListener("changed", () => { void refresh(); });
    events.onopen = () => { if (polling) clearInterval(polling); polling = undefined; };
    events.onerror = () => { polling ??= setInterval(() => { void refresh(); }, 3000); };
    return () => { events.close(); if (polling) clearInterval(polling); revision.current++; };
  }, [refresh]);
  const post = useCallback(async (url: string, body: object) => {
    setPending(true); setError(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, me }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error ?? "요청을 처리하지 못했습니다.");
      if (currentMe.current === me) { revision.current++; setVm(next as ViewModel); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청을 처리하지 못했습니다.");
      await refresh();
    } finally { setPending(false); }
  }, [me, refresh]);
  const actions = useMemo<ViewModelActions>(() => ({
    sendMessage: async (text, files) => { try { await post("/api/messages", { authorId: me, text, attachments: await Promise.all(files.map(fileContent)) }); } catch (e) { setError(e instanceof Error ? e.message : "첨부 오류"); } },
    decideCard: (id, approve) => post(`/api/cards/${encodeURIComponent(id)}`, { memberId: me, approve }),
    setAvailability: (memberId, weeklyHours) => post("/api/availability", { memberId, weeklyHours }),
    scenarioNext: () => post("/api/scenario/next", {}),
    startFree: (goal, deadline) => post("/api/free/start", { goal, deadline }),
    startScenario: name => post("/api/scenario/start", { name }),
    switchMe: memberId => { setMe(memberId); setError(null); },
  }), [me, post]);
  return { vm: vm ? { ...vm, busy: vm.busy || pending } : null, error, actions };
}
