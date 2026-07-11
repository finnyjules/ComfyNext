// Restore the persisted tab session AFTER hydration. useTabs initializes with
// the same home-only state the server rendered (SSR has no sessionStorage), so
// hydration sees identical markup; this hook then swaps in the saved tabs on
// the first post-mount tick. Restoring earlier (module scope) made the client's
// first render diverge from the SSR HTML — the source of the long-standing
// "Hydration completed but contains mismatches" warning on every loaded page.
import { restorePersistedTabsOnce } from '~/composables/useTabs'

export default defineNuxtPlugin((nuxtApp) => {
  // app:suspense:resolve, NOT app:mounted: the default layout is an async
  // component whose subtree hydrates AFTER the root mounts. Restoring at
  // app:mounted flipped the tab state in that gap, so the layout's deferred
  // hydration compared the server's home-only HTML against project-tab vdom
  // and still logged mismatches. suspense:resolve fires once every async
  // subtree has finished loading and hydrating. (restorePersistedTabsOnce is
  // self-guarded, so later navigations re-firing this hook are no-ops.)
  nuxtApp.hook('app:suspense:resolve', () => restorePersistedTabsOnce())
})
