// 문서: a press-release draft with a campaign schedule table. The "광고 집행
// 11/1" row is the stale-date target of later beats.
import React from 'react';
import {colors} from '../../v3/tokens/video';
import {DocCheckIcon} from '../../ui/icons';
import {DOC} from '../content';
import {useFs} from './SurfaceFrame';

const Line: React.FC<{w: string; strong?: boolean}> = ({w, strong}) => (
  <div style={{height: 12, width: w, borderRadius: 6, background: strong ? colors.outlineVariant : colors.surfaceContainerHigh}} />
);

export const Doc: React.FC = () => {
  const fs = useFs();
  return (
    <div style={{position: 'absolute', inset: 0, background: colors.surfaceContainer, display: 'flex', flexDirection: 'column'}}>
      <div style={{height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', background: colors.surface, borderBottom: `1px solid ${colors.outlineVariant}`}}>
        <DocCheckIcon size={30} color={colors.onSurfaceVariant} />
        <span style={{fontSize: fs(26), fontWeight: 700}}>{DOC.title}</span>
        <span style={{marginLeft: 'auto', fontSize: fs(20), fontWeight: 600, padding: '2px 12px', borderRadius: 10, background: colors.surfaceContainerHigh, color: colors.onSurfaceVariant}}>{DOC.badge}</span>
      </div>
      <div style={{flex: 1, padding: '22px 26px 0'}}>
        {/* the page */}
        <div
          style={{
            height: '100%',
            borderRadius: '10px 10px 0 0',
            background: colors.surface,
            boxShadow: '0 -1px 0 rgba(201,209,203,.8), 0 2px 10px -2px rgba(23,59,48,.18)',
            padding: '28px 30px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{fontSize: fs(34), fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 6}}>{DOC.title}</div>
          <Line w="100%" strong />
          <Line w="92%" />
          <Line w="97%" />
          <Line w="64%" />
          <div style={{fontSize: fs(24), fontWeight: 700, marginTop: 22, marginBottom: 2}}>{DOC.scheduleTitle}</div>
          <div style={{borderRadius: 12, boxShadow: `inset 0 0 0 1.5px ${colors.outlineVariant}`, overflow: 'hidden'}}>
            {DOC.rows.map((r, i) => (
              <div
                key={r.item}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 18px',
                  fontSize: fs(22),
                  fontWeight: 500,
                  background: i % 2 ? colors.surfaceContainerLow : colors.surface,
                  borderTop: i ? `1px solid ${colors.outlineVariant}` : undefined,
                }}
              >
                <span style={{flex: 1}}>{r.item}</span>
                <span style={{fontWeight: 700, fontVariantNumeric: 'tabular-nums'}}>{r.date}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
