'use strict';

const { useState, useRef, useCallback, useTransition, useEffect } = require('react');
const { createActionGuard } = require('./createActionGuard');

/**
 * Shaped after React's built-in useActionState(action, initialState):
 *   const [state, formAction, isPending] = useActionState(action, initialState)
 *
 * useGuardedActionState adds exactly one guarantee useActionState doesn't
 * give you: if formAction is called again before the previous call
 * resolves, only the result of the LATEST call is ever applied to state.
 * An earlier call that happens to resolve later is discarded instead of
 * clobbering newer state - this is the actual bug class this package
 * exists to prevent.
 *
 * `action` receives (previousState, payload), same as useActionState's
 * action - so existing Server Actions written for useActionState work
 * here without changes to their own signature.
 *
 * WHAT THIS DOES NOT DO: see createActionGuard.js - no true server-side
 * cancellation, this only guards which result gets applied to state.
 *
 * @param {(previousState: any, payload: any) => Promise<any>} action
 * @param {*} initialState
 * @returns {[state: any, dispatch: (payload: any) => void, isPending: boolean]}
 */
function useGuardedActionState(action, initialState) {
  const [state, setState] = useState(initialState);
  const [isPending, startTransition] = useTransition();

  const guardRef = useRef(null);
  if (guardRef.current === null) {
    guardRef.current = createActionGuard();
  }

  const stateRef = useRef(initialState);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    return () => {
      guardRef.current.invalidate();
    };
  }, []);

  const dispatch = useCallback(
    (payload) => {
      startTransition(async () => {
        const result = await guardRef.current.run(() => action(stateRef.current, payload));
        if (result.stale) {
          return;
        }
        if (result.error) throw result.error;
        setState(result.value);
      });
    },
    [action]
  );

  return [state, dispatch, isPending];
}

module.exports = { useGuardedActionState };
