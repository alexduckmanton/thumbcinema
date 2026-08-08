/**
 * The one place the preview chunk is named.
 *
 * `FlipbookCard` hands this to `lazy()` and `useCardGesture` calls it to prefetch, and
 * both have to be talking about the same `import()` or the module would be fetched
 * twice and — worse — split into two chunks holding two copies of the cache. Named
 * rather than inlined for the same reason it is warmed rather than awaited: a factory
 * you can call yourself is one you can run early.
 *
 * Nothing of the preview is imported here, only its address. This module is in the
 * entry bundle; the thing it points at is not, and that is the whole arrangement.
 */
export const loadPreview = () => import('../preview/FlipbookPreview')
