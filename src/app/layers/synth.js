import { createSynthLayer } from '../../layers/synth/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire SYNTH's live places to the application overlay host. */
export function createApplicationSynth(options) {
  return createSynthLayer({ overlayHost, ...options });
}
