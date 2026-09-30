/** Shared calendar date for PM copy and the roadmap, always in Asia/Seoul. */
export function formatKstDate(value: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).formatToParts(new Date(value));
  return `${parts.find(p => p.type === 'month')!.value}/${parts.find(p => p.type === 'day')!.value}`;
}
