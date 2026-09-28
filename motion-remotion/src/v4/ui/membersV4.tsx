// v4 round C: one avatar per team member, identical wherever it appears
// (team list, message rows, plan-card rows, handoff chain). v3 drew the same
// person with different letters/colors per component (AI PM "A" in the list
// but "P" in messages; agents "A" in messages, "조"/"경" elsewhere; 이서연 in
// the list with 김도윤's color).
//
// Choices: the AI PM and agents keep the team-list letter (AI PM "A",
// 경쟁사 조사 Agent "경", 프로토타입 Agent "프"). The two people use the
// initials content.ts already defines (people.*.initial "도" / "서", as
// specified in storyboard-v3 §3) rather than the list's surname letters —
// with a surname letter both people would read as family-name badges and
// 김도윤's "김" would not match his own message rows.
import React from 'react';
import {ClayAvatar} from '../../v3/ui/primitives/ClayAvatar';
import {people, agents} from '../../v3/ui/content';
import {colors} from '../../v3/tokens/video';

export type MemberId = 'pm' | 'domyun' | 'seoyeon' | 'research' | 'prototype';

export const MEMBERS: Record<MemberId, {kind: 'pm' | 'human' | 'agent'; base: string; label: string}> = {
  pm: {kind: 'pm', base: colors.pm, label: 'A'},
  domyun: {kind: 'human', base: people.domyun.color, label: people.domyun.initial},
  seoyeon: {kind: 'human', base: people.seoyeon.color, label: people.seoyeon.initial},
  research: {kind: 'agent', base: agents.research.color, label: '경'},
  prototype: {kind: 'agent', base: agents.prototype.color, label: '프'},
};

// Resolves any display name used in content.ts to its member.
export const memberOf = (who: string): MemberId => {
  if (who === 'pm' || who === 'domyun' || who === 'seoyeon' || who === 'research' || who === 'prototype') return who;
  if (who.includes('PM')) return 'pm';
  if (who.includes('도윤')) return 'domyun';
  if (who.includes('서연')) return 'seoyeon';
  if (who.includes('조사')) return 'research';
  if (who.includes('프로토타입')) return 'prototype';
  throw new Error(`[v4] unknown member "${who}"`);
};

export const MemberAvatar: React.FC<{who: string; size: number; frame?: number}> = ({who, size, frame}) => {
  const m = MEMBERS[memberOf(who)];
  return <ClayAvatar kind={m.kind} base={m.base} label={m.label} size={size} frame={frame} />;
};
