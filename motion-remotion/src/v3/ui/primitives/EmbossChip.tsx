// v3 §3 "엠보스 pill(칩·배지)" — used for status chips, badges, and buttons.
// Round-3 fix: all sizing constants are LOGICAL board px, like every other
// element in the K=2-scaled board DOM, but this component was rendering them
// as raw (undoubled) CSS px — chips were literally half the intended size,
// which is why hero chips read ~12-15px on screen instead of the spec's
// >=36px. Fixed via px(); `scale` lets a specific hero instance go bigger
// still (spec: hero chips/badges should be unmistakable).
import React from 'react';
import {embossChipShadow, uiType, px} from '../../tokens/video';

function tint(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const c = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const mix = (v: number) => Math.max(0, Math.min(255, Math.round(v + (255 - v) * amt)));
  return `rgb(${mix(c(0))},${mix(c(2))},${mix(c(4))})`;
}

export interface EmbossChipProps {
  label: string;
  container: string;
  onContainer: string;
  icon?: React.ReactNode;
  height?: number; // logical px
  fontSize?: number; // logical px
  scale?: number; // extra multiplier on top of the K doubling, for hero emphasis
}

export const EmbossChip: React.FC<EmbossChipProps> = ({label, container, onContainer, icon, height = 24, fontSize, scale = 1}) => {
  const H = px(height) * scale;
  const FS = px(fontSize ?? uiType.labelMd.fontSize) * scale;
  const LH = px(uiType.labelMd.lineHeight) * scale;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: px(4) * scale,
        height: H,
        padding: `0 ${H * 0.4}px`,
        borderRadius: 9999,
        background: `linear-gradient(180deg, ${tint(container, 0.04)}, ${container})`,
        boxShadow: embossChipShadow,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      <span
        style={{
          fontFamily: 'Pretendard',
          fontSize: FS,
          lineHeight: `${LH}px`,
          fontWeight: uiType.labelMd.fontWeight,
          color: onContainer,
        }}
      >
        {label}
      </span>
    </div>
  );
};
