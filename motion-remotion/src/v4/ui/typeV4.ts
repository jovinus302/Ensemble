// v4 in-board type scale (round 3, design-v4 r2 §4: secondary text — bodySm /
// labels — must be >= 18px on screen). v3's uiType keeps DESIGN.md's product
// sizes (labelSm 11, labelMd 12, bodySm 12), which land at 15.8-17.4px at the
// v4 frontal zooms (1.435-1.45). The smallest board-plane zoom is SF1b's
// 1.435, so secondary text needs >= 18 / 1.435 = 12.54 logical -> 13
// (18.7px at 1.435, 18.9px at 1.45). Line heights are kept as-is so no row,
// card or panel block moves; 13px glyphs fit the existing 16/18 line boxes.
// Body/title sizes are unchanged (already >= 20px at these zooms).
import {uiType} from '../../v3/tokens/video';

export const SECONDARY_FONT = 13; // logical px

export const uiTypeV4 = {
  ...uiType,
  bodySm: {...uiType.bodySm, fontSize: SECONDARY_FONT},
  labelMd: {...uiType.labelMd, fontSize: SECONDARY_FONT},
  labelSm: {...uiType.labelSm, fontSize: SECONDARY_FONT},
} as const;

// Avatar initials are sized by ClayAvatar as 0.4 x avatar size; a 32-logical
// avatar gives 12.8 logical -> 18.4px at 1.435 (v3 sidebar used 28 -> 16.1px).
export const SIDEBAR_AVATAR = 32;
