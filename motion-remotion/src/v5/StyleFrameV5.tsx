// v5 style frame SF-A (storyboard-v5.md §5): B1 f140 composition in three world
// options (A1 clay / A2 ceramic / A3 bold). Options differ only on the free
// axes (material, light direction, thickness, background tone, camera angle);
// the five surfaces, their content, the copy and the color roles are shared.
// Props: still ('A1'|'A2'|'A3'), measure (log text sizes + headline/surface
// clearance to the console).
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender} from 'remotion';
import {ensurePretendardLoaded, ensurePretendardVariableLoaded} from '../tokens/fonts';
import {KineticHeadline} from '../v3/type/KineticHeadline';
import {TypeLayer} from '../v4/stage/StageV4';
import {COPY, HEADLINE_BOX, LOOKS, MIN_SCREEN_TEXT_PX, SURFACES, placementsFor} from './config';
import type {StillId, SurfaceId} from './config';
import {beatStart} from './timing';
import {WorldStage} from './stage/WorldStage';
import {surfaceScreenBounds, surfaceScreenScale} from './stage/worldProject';
import {SurfaceFrame} from './surfaces/SurfaceFrame';
import {Messenger} from './surfaces/Messenger';
import {Canvas} from './surfaces/Canvas';
import {Meeting} from './surfaces/Meeting';
import {Doc} from './surfaces/Doc';
import {AgentTerminal} from './surfaces/AgentTerminal';

export interface StyleFrameV5Props {
  still?: StillId;
  measure?: boolean;
}

// SF-A is B1 f140: beat start from timing.json + offset. The headline is fully in by then.
const SF_A_FRAME = beatStart('B1') + 140;
const HEADLINE_LOCAL_FRAME = 400; // KineticHeadline local frame: all words settled

const BODY: Record<SurfaceId, React.FC> = {M: Meeting, D: Canvas, S: Messenger, P: Doc, A: AgentTerminal};
// paint hint only; real order comes from 3D depth sorting
const wordsOf = (copy: string) => copy.split(' ').map((text) => ({text}));

const Inner: React.FC<{still: StillId; measure?: boolean}> = ({still, measure}) => {
  const look = LOOKS[still];
  const places = placementsFor(look);
  const headRef = useRef<HTMLDivElement>(null);

  const geo = (Object.keys(SURFACES) as SurfaceId[]).map((id) => {
    const scale = surfaceScreenScale(look.camera, places[id]);
    return {id, scale, floor: Math.ceil((MIN_SCREEN_TEXT_PX + 0.6) / scale), bounds: surfaceScreenBounds(look.camera, places[id])};
  });
  const farZ = Math.min(...geo.map((g) => places[g.id].z));

  useLayoutEffect(() => {
    if (!measure) return;
    const hb = (headRef.current?.firstElementChild as HTMLElement | null)?.getBoundingClientRect();
    const texts: {surface: string; text: string; px: number}[] = [];
    document.querySelectorAll<HTMLElement>('[data-surface]').forEach((el) => {
      const g = geo.find((x) => x.id === el.dataset.surface);
      if (!g) return;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const t = n.textContent?.trim();
        const parent = n.parentElement;
        if (!t || !parent) continue;
        const fs = parseFloat(getComputedStyle(parent).fontSize);
        texts.push({surface: g.id, text: t, px: Math.round(fs * g.scale * 10) / 10});
      }
    });
    const small = texts.filter((t) => t.px < MIN_SCREEN_TEXT_PX);
    // eslint-disable-next-line no-console
    console.log(
      'V5-MEASURE ' +
        JSON.stringify({
          still,
          headline: hb && {x0: Math.round(hb.left), x1: Math.round(hb.right), y0: Math.round(hb.top), y1: Math.round(hb.bottom)},
          surfaces: geo.map((g) => ({id: g.id, scale: +g.scale.toFixed(3), floor: g.floor, b: Object.fromEntries(Object.entries(g.bounds).map(([k, v]) => [k, Math.round(v)]))})),
          smallText: small,
        }),
    );
  }, [measure, still]);

  return (
    <WorldStage
      frame={SF_A_FRAME}
      look={look}
      surfaces={geo.map((g) => {
        const Body = BODY[g.id];
        const p = places[g.id];
        return (
          <SurfaceFrame key={g.id} place={p} look={look} fontFloor={g.floor} aerial={(0 - p.z) / (0 - farZ)} label={g.id} dark={g.id === 'A'}>
            <Body />
          </SurfaceFrame>
        );
      })}
      overlay={
        <TypeLayer>
          <div ref={headRef} style={{position: 'absolute', left: HEADLINE_BOX.left, top: HEADLINE_BOX.top, width: HEADLINE_BOX.width}}>
            <KineticHeadline words={wordsOf(COPY.B1)} frame={HEADLINE_LOCAL_FRAME} variant="T1" align="left" top={0} left={0} width={HEADLINE_BOX.width} />
          </div>
        </TypeLayer>
      }
    />
  );
};

export const StyleFrameV5: React.FC<StyleFrameV5Props> = ({still = 'A1', measure}) => {
  const [handle] = useState(() => delayRender('loading fonts (StyleFrameV5)'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([ensurePretendardLoaded(), ensurePretendardVariableLoaded()])
      .then(() => {
        setReady(true);
        continueRender(handle);
      })
      .catch((err) => {
        console.error(err);
        continueRender(handle);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!ready) return <AbsoluteFill style={{backgroundColor: '#F4F1EA'}} />;
  return <Inner still={still} measure={measure} />;
};
