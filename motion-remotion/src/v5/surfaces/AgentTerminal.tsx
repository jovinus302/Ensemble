// 지은의 Agent: terminal-style window. Top zone "비공개 작업" is locked and
// blurred (the thread never enters it); bottom slot "공유 요청함" is the only
// place a shared brief can land. The one dark surface in the world: it uses the
// on-surface ink from the style bible as its body, so the five tools are not
// five white cards.
import React from 'react';
import {colors} from '../../v3/tokens/video';
import {LockIcon} from '../../ui/icons';
import {AGENT} from '../content';
import {useFs} from './SurfaceFrame';

const INK = colors.onSurface; // #18201C
const TEXT = '#E3E9E5';
const MUTED = '#A8B4AD';

export const AgentTerminal: React.FC = () => {
  const fs = useFs();
  return (
    <div style={{position: 'absolute', inset: 0, background: INK, color: TEXT, display: 'flex', flexDirection: 'column'}}>
      <div style={{height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', background: '#222B26', borderBottom: '1px solid rgba(255,255,255,.08)'}}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{width: 14, height: 14, borderRadius: 7, background: '#4A5650'}} />
        ))}
        <span style={{marginLeft: 12, fontSize: fs(24), fontWeight: 700}}>{AGENT.title}</span>
      </div>
      {/* private area */}
      <div style={{position: 'relative', flex: 1, padding: '16px 22px 0'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 10, fontSize: fs(22), fontWeight: 600, color: MUTED}}>
          <LockIcon size={fs(22)} color={MUTED} />
          {AGENT.privateLabel}
        </div>
        <div style={{marginTop: 12, display: 'flex', flexDirection: 'column', gap: 11, filter: 'blur(4.5px)', opacity: 0.85}}>
          {['78%', '92%', '60%'].map((w, i) => (
            <div key={i} style={{height: 13, width: w, borderRadius: 7, background: i === 1 ? '#9AA8A0' : '#6B7871'}} />
          ))}
        </div>
      </div>
      <div style={{height: 2, background: 'rgba(255,255,255,.1)', margin: '0 22px'}} />
      {/* shared inbox slot */}
      <div style={{flexShrink: 0, padding: '14px 22px 18px'}}>
        <div style={{fontSize: fs(22), fontWeight: 600, color: TEXT, marginBottom: 10}}>{AGENT.inboxLabel}</div>
        <div
          style={{
            height: 64,
            borderRadius: 14,
            border: '2.5px dashed #5C6A63',
            display: 'flex',
            alignItems: 'center',
            padding: '0 18px',
            fontSize: fs(20),
            color: MUTED,
            fontWeight: 500,
          }}
        >
          <span style={{fontWeight: 700, color: TEXT, marginRight: 10}}>{'>'}</span>
          {AGENT.inboxEmpty}
          <span style={{marginLeft: 8, width: 12, height: 26, background: TEXT, opacity: 0.8}} />
        </div>
      </div>
    </div>
  );
};
