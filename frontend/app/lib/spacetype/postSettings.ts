// Moved to ~/lib/studio/post/settings — post is shared by every studio, not a
// Space Type detail. Kept as a re-export because a dozen modules import this path
// (scene3d/config.ts, scene3d/controls.ts, embed/surfaces/spacetype.ts, post.ts…).
export type { PostSettings } from '~/lib/studio/post/settings'
export { DEFAULT_POST, postEnabled } from '~/lib/studio/post/settings'
