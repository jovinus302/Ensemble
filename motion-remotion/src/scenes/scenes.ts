// Scene table — storyboard-v2.md §2. Phase 2a implements S01-S04 (0-750f).
// S05-S08 kept as metadata only (Phase 2b) so the Full composition timeline is
// consistent; their headline copy is not rendered yet. Full art-direction notes
// for S05-S08 (badge morph, counter roll, strike-line, wordmark reveal) are kept
// in storyboard-v2.md §0.1/§2 for the 2b pass, not duplicated here.
export type SceneAlign = 'center' | 'left';
export type HeadlineVariant = 'blur' | 'perChar' | 'pmSnap' | 'default';

export type SceneMeta = {
  id: 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07' | 'S08';
  start: number;
  end: number;
  headline: string;
  align: SceneAlign;
  variant: HeadlineVariant;
  implemented: boolean;
};

export const scenes: SceneMeta[] = [
  {id: 'S01', start: 0, end: 195, headline: '인계는, 아직 사람의 몫', align: 'center', variant: 'blur', implemented: true},
  {id: 'S02', start: 195, end: 345, headline: '팀엔, 지휘자가 없다', align: 'left', variant: 'perChar', implemented: true},
  {id: 'S03', start: 345, end: 510, headline: '이 팀엔 PM이 있다', align: 'center', variant: 'pmSnap', implemented: true},
  {id: 'S04', start: 510, end: 750, headline: '배정과 인계, 한 흐름에서', align: 'left', variant: 'default', implemented: true},
  {id: 'S05', start: 750, end: 930, headline: '말이 아니라, 증거로 판정', align: 'center', variant: 'default', implemented: false},
  {id: 'S06', start: 930, end: 1110, headline: '2주, 2~5인 팀을 위해', align: 'center', variant: 'default', implemented: false},
  {id: 'S07', start: 1110, end: 1320, headline: '1인 도구가 아닌, 팀의 PM', align: 'left', variant: 'default', implemented: false},
  {id: 'S08', start: 1320, end: 1500, headline: '다음 일은, PM이 잇는다', align: 'center', variant: 'default', implemented: false},
];

export const getScene = (frame: number): SceneMeta => {
  return scenes.find((s) => frame >= s.start && frame < s.end) ?? scenes[scenes.length - 1];
};
