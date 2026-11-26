import { useEffect, useState } from 'react'

interface Settled<T> {
  fn: unknown
  arg: unknown
  data: T | null
  error: Error | null
}

/**
 * Run `fn(arg)` and track its result. `fn` must be stable (a module-level
 * function), so the effect re-runs only when `fn` or `arg` changes. State is
 * set only when the promise settles; `loading` is derived by checking whether
 * the stored result belongs to the current `fn` and `arg`.
 */
export function useAsync<T, A = undefined>(fn: (arg: A) => Promise<T>, arg?: A): { data: T | null; error: Error | null; loading: boolean } {
  const [state, setState] = useState<Settled<T> | null>(null)
  useEffect(() => {
    let live = true
    fn(arg as A).then(
      (data) => {
        if (live) setState({ fn, arg, data, error: null })
      },
      (error: Error) => {
        if (live) setState({ fn, arg, data: null, error })
      },
    )
    return () => {
      live = false
    }
  }, [fn, arg])
  const current = state !== null && state.fn === fn && Object.is(state.arg, arg)
  return { data: current ? state.data : null, error: current ? state.error : null, loading: !current }
}
