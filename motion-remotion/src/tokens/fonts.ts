import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

export const FONT_FAMILY = 'Pretendard';
// v3 only: variable-weight family used for KineticHeadline wght morphing (400<->800).
export const FONT_FAMILY_VARIABLE = 'PretendardVariable';

let loaded: Promise<void> | null = null;

export const ensurePretendardLoaded = (): Promise<void> => {
  if (loaded) return loaded;
  loaded = Promise.all([
    loadFont({family: FONT_FAMILY, url: staticFile('fonts/Pretendard-Regular.woff2'), weight: '400'}),
    loadFont({family: FONT_FAMILY, url: staticFile('fonts/Pretendard-Medium.woff2'), weight: '500'}),
    loadFont({family: FONT_FAMILY, url: staticFile('fonts/Pretendard-SemiBold.woff2'), weight: '600'}),
    loadFont({family: FONT_FAMILY, url: staticFile('fonts/Pretendard-Bold.woff2'), weight: '700'}),
    loadFont({family: FONT_FAMILY, url: staticFile('fonts/Pretendard-ExtraBold.woff2'), weight: '800'}),
  ]).then(() => undefined);
  return loaded;
};

// v3 only: loads the variable-weight woff2 under FONT_FAMILY_VARIABLE, range 400-800,
// used where KineticHeadline needs to animate `font-variation-settings: 'wght' N`.
let loadedVariable: Promise<void> | null = null;

export const ensurePretendardVariableLoaded = (): Promise<void> => {
  if (loadedVariable) return loadedVariable;
  loadedVariable = loadFont({
    family: FONT_FAMILY_VARIABLE,
    url: staticFile('fonts/PretendardVariable.woff2'),
    weight: '400 800',
  }).then(() => undefined);
  return loadedVariable;
};
