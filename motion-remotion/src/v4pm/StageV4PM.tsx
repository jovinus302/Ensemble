import React from 'react';
import type {CameraPose} from '../v3/tokens/video';
import {PERSPECTIVE, STAGE_W, STAGE_H} from '../v3/tokens/video';
import {Background} from '../v3/stage/Background';
import {BoardRig} from '../v4/stage/StageV4';
import {WallShadow} from '../v4/fx/WallShadow';

// 승인된 3층 무대. 사용자 피드백에 따라 그레인 레이어를 제외한다.
export const StageV4PM: React.FC<{pose: CameraPose; board: React.ReactNode; slab?: React.ReactNode; overlay?: React.ReactNode}> = ({pose, board, slab, overlay}) => <div style={{position: 'absolute', width: STAGE_W, height: STAGE_H, perspective: PERSPECTIVE, perspectiveOrigin: '960px 540px', overflow: 'hidden', backgroundColor: '#F4F1EA'}}>
  <Background frame={400}/>
  <WallShadow pose={pose}/>
  {slab && <BoardRig pose={pose}>{slab}</BoardRig>}
  <BoardRig pose={pose}>{board}</BoardRig>
  {overlay}
</div>;
