// Scenario image keys stay serializable; only the browser UI imports image files.
import adA from './assets/ad-a.jpg';
import adB from './assets/ad-b.jpg';
import adC from './assets/ad-c.jpg';
import shortV10 from './assets/short-v10.jpg';
import shortV11 from './assets/short-v11.jpg';
import harin from './assets/avatar-harin.jpg';
import junho from './assets/avatar-junho.jpg';
import minjae from './assets/avatar-minjae.jpg';
import seoa from './assets/avatar-seoa.jpg';

export const imageSources: Record<string, string> = {
  '/s27/ad-a.jpg': adA.src,
  '/s27/ad-b.jpg': adB.src,
  '/s27/ad-c.jpg': adC.src,
  '/s27/short-v10.jpg': shortV10.src,
  '/s27/short-v11.jpg': shortV11.src,
  '/s27/avatar-harin.jpg': harin.src,
  '/s27/avatar-junho.jpg': junho.src,
  '/s27/avatar-minjae.jpg': minjae.src,
  '/s27/avatar-seoa.jpg': seoa.src,
};
