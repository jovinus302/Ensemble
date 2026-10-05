export type Phase = 'assigned' | 'working' | 'draft' | 'checking' | 'review' | 'changes' | 'handed';
export type Message = { speaker: 'PM' | '나' | '리뷰어' | 'UX'; text: string };
export type State = { phase: Phase; version: number; shared: number; run: number; messages: Message[]; notice: string };
export type Action = { type: 'work' | 'finish' | 'share' | 'checked' | 'approve' | 'reject' | 'cancel' | 'reset'; run: number; version: number };
export const initialHandoff = (run = 0): State => ({ phase: 'assigned', version: 1, shared: 0, run, notice: '', messages: [
  { speaker: 'PM', text: '상성님, T-1 로그인 오류 처리를 맡아주세요. 만료된 링크에서 다시 시도할 수 있고, 키보드로도 복구할 수 있어야 해요. 구현과 테스트 근거를 이 작업에 공유해 주세요.' },
  { speaker: '나', text: '네. 제 Coding Agent와 구현하고 결과를 공유할게요.' },
] });
const add = (s: State, phase: Phase, messages: Message[], extra: Partial<State> = {}): State => ({ ...s, phase, notice: '', messages: [...s.messages, ...messages], ...extra });
export function handoffReducer(s: State, a: Action): State {
  if (a.run !== s.run) return s;
  if (a.type === 'reset') return initialHandoff(s.run + 1);
  if (a.version !== s.version) return { ...s, notice: `v${a.version}은 이전 결과예요. 현재 v${s.version}의 근거와 검토가 필요합니다.` };
  if (a.type === 'cancel' && (s.phase === 'working' || s.phase === 'checking')) return add(s, s.phase === 'working' ? (s.version === 1 ? 'assigned' : 'changes') : 'draft', [], { run: s.run + 1, notice: '진행을 취소했어요. 늦게 도착한 결과는 반영하지 않습니다.' });
  if (a.type === 'work' && (s.phase === 'assigned' || s.phase === 'changes')) return add(s, 'working', []);
  if (a.type === 'finish' && s.phase === 'working') return add(s, 'draft', []);
  if (a.type === 'share' && s.phase === 'draft') return add(s, 'checking', s.shared === s.version ? [] : [
    { speaker: '나', text: `T-1 결과 v${s.version} 공유합니다. 만료 링크 복구 화면과 키보드 테스트 근거를 첨부했어요.${s.version > 1 ? ' 요청하신 포커스 복귀도 수정했습니다.' : ''}` },
    { speaker: 'PM', text: `v${s.version} 받았어요. 완료 기준과 T-2의 선행 조건을 대조할게요. 산출물만으로 작업을 완료하지는 않을게요.` },
  ], { shared: s.version });
  if (a.type === 'checked' && s.phase === 'checking') return add(s, 'review', [
    { speaker: 'PM', text: '복구 화면과 테스트 근거가 연결되어 있어요. 지윤님, 키보드 포커스가 복구 버튼으로 돌아오는지 검토해 주세요. 검토가 끝날 때까지 UX 인계는 기다릴게요.' },
  ]);
  if (a.type === 'reject' && s.phase === 'review') return add(s, 'changes', [
    { speaker: '리뷰어', text: `v${s.version} 수정 요청합니다. 오류 후 포커스가 사라져요. 복구 버튼으로 돌아오도록 수정하고 테스트 근거를 갱신해 주세요.` },
    { speaker: 'PM', text: 'T-1은 수정 중으로 남겨둘게요. 상성님에게 검토 의견을 연결했고, T-2는 계속 대기합니다.' },
  ], { version: s.version + 1 });
  if (a.type === 'approve' && s.phase === 'review' && s.shared === s.version) return add(s, 'handed', [
    { speaker: '리뷰어', text: `v${s.version} 검토 완료. 만료 링크 복구와 키보드 포커스 기준을 확인했어요.` },
    { speaker: 'PM', text: `T-1 완료를 기록했어요. UX Agent에게 T-2 오류 안내 문구 검토를 인계합니다. 목표, v${s.version} 산출물, 검토 결정, 유지할 복구 동작을 함께 전달했어요.` },
    { speaker: 'UX', text: `T-2 받았어요. v${s.version}의 복구 동작은 유지하고 안내 문구와 버튼 표현을 검토할게요. 상성님이 다시 설명해 주실 필요 없어요.` },
  ]);
  return s;
}
