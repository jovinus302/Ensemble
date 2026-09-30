// 서버 렌더와 브라우저 렌더가 같은 글자를 내도록 시간대를 서울로 고정한다.
const dateFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : timeFmt.format(d);
}

const STATUS: Record<string, { label: string; tone: "done" | "working" | "needs" | "failed" | "queued" }> = {
  done: { label: "완료", tone: "done" },
  checked: { label: "완료", tone: "done" },
  in_progress: { label: "진행 중", tone: "working" },
  working: { label: "진행 중", tone: "working" },
  submitted: { label: "검토 대기", tone: "needs" },
  blocked: { label: "막힘", tone: "needs" },
  failed: { label: "실패", tone: "failed" },
  dropped: { label: "제외", tone: "failed" },
  todo: { label: "대기", tone: "queued" },
  pending: { label: "대기", tone: "queued" },
};

export function statusInfo(status: string) {
  return STATUS[status] ?? { label: status, tone: "queued" as const };
}

export function initial(name: string): string {
  return Array.from(name.trim())[0] ?? "?";
}
