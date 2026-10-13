// Type definitions for use-guarded-action

/**
 * Result descriptor returned by ActionGuard#run(). Never rejects - check
 * `stale` before trusting `value`/`error`.
 */
export interface GuardResult<T> {
  /** True if a newer run() call has started since this one began. */
  stale: boolean;
  /** The resolved value, if the call succeeded and is not stale. */
  value: T | undefined;
  /** The rejection reason, if the call failed (present even if stale). */
  error: unknown;
}

export interface ActionGuard {
  /**
   * Run a promise (or a function that returns one) under the guard.
   * Always resolves - never rejects - with a GuardResult.
   */
  run<T>(promiseOrFactory: Promise<T> | (() => Promise<T>)): Promise<GuardResult<T>>;
  /**
   * Force everything currently in flight to be treated as stale when it
   * resolves, without starting a new call yourself.
   */
  invalidate(): void;
  /** The current latest token - mostly useful for tests/debugging. */
  getToken(): number;
}

/** Framework-agnostic sequence guard. No React dependency. */
export function createActionGuard(): ActionGuard;

export interface UseActionGuardResult {
  /**
   * Run a promise (or factory) under this component instance's guard.
   * Never rejects - always resolves to a GuardResult.
   */
  guard: <T>(promiseOrFactory: Promise<T> | (() => Promise<T>)) => Promise<GuardResult<T>>;
  /** Marks everything currently in flight as stale. Also called automatically on unmount. */
  invalidate: () => void;
}

/**
 * Low-level hook for when you're managing useOptimistic/useTransition
 * yourself and just need the sequencing guard as a building block.
 */
export function useActionGuard(): UseActionGuardResult;

/**
 * Shaped after React's built-in useActionState(action, initialState).
 * Guarantees that if `dispatch` is called again before the previous call
 * resolves, only the result of the LATEST call is ever applied to state.
 *
 * @param action Receives (previousState, payload) and returns a Promise of the new state.
 * @param initialState The initial state value.
 */
export function useGuardedActionState<State, Payload = unknown>(
  action: (previousState: State, payload: Payload) => Promise<State>,
  initialState: State
): [state: State, dispatch: (payload: Payload) => void, isPending: boolean];
