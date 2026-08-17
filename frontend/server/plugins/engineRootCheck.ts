/**
 * Boot-time guard (pre-deploy fix S2). The overwrite-ownership gate in
 * inputUploads.ts now fails CLOSED when the shared ComfyUI engine root can't
 * be resolved (refuses every ambiguous overwrite) rather than failing open
 * (existsSync missing every disk check). A misconfigured deploy should say
 * so loudly at startup, not just surface as opaque 403s on someone's first
 * overwriting upload.
 *
 * Nothing here can delay or fail boot — checkEngineRootOnBoot is a
 * synchronous filesystem walk (no ledger, no network), so unlike
 * holdSweep.ts there's no timer to schedule; it just runs and logs once.
 */
import { checkEngineRootOnBoot } from '../utils/inputUploads'

export default defineNitroPlugin(() => {
  checkEngineRootOnBoot()
})
