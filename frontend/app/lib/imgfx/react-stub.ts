// React stub — img-fx ships a single bundle that statically imports `react` and
// `react/jsx-runtime` for its optional <ImageGeneration> React component. We
// only use img-fx's framework-agnostic core (createInstance/createReveal/
// createCycle), never the component, so we alias `react` + `react/jsx-runtime`
// to this file (see nuxt.config.ts → vite.resolve.alias). The component is still
// *defined* at module-eval (forwardRef runs), but never *rendered*, so no-op
// hooks are safe and React never ships in the bundle. Verified: aliasing here
// drops all React source + internals from the build.
//
// If a future img-fx version imports additional React APIs, add matching no-op
// exports below (a missing export surfaces as a build-time "not exported" error,
// not a silent runtime bug).

export const forwardRef = <T>(fn: T): T => fn
export const useRef = () => ({ current: null })
export const useState = (v: unknown) => [typeof v === 'function' ? (v as () => unknown)() : v, () => {}]
export const useImperativeHandle = () => {}
export const useLayoutEffect = () => {}
export const useEffect = () => {}
export const useMemo = () => undefined
export const useCallback = <T>(fn: T): T => fn
export const useContext = () => undefined
export const createElement = () => null
export const Fragment = Symbol.for('imgfx.react-stub.Fragment')
export const jsx = () => null
export const jsxs = () => null
export const jsxDEV = () => null

export default {}
