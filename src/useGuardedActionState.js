'use strict';
'use client';

const { useState, useRef, useCallback, useTransition, useEffect } = require('react');
const { createActionGuard } = require('./createActionGuard');

/**
 * NOTE ON isPending: React 19 correctly tracks useTransition's isPending
 * across an async callback's await points ("async transitions"). React 18
 * does NOT - it flips isPending back to false as soon as the callback
 * function returns, which for an async function is immediately (before
 * any awaited work finishes), making useTransition's own isPending
 * unreliable on 18. So this hook tracks isPending itself with a ref-free
 * explicit state flag - correct on both versions - and only uses
 * useTransition for what it reliably does on both: marking the state
 * update as a transition for scheduling/priority purposes.
 */

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
 * Errors thrown by `action` propagate the same way they would inside any
 * transition (i.e. will surface via an error boundary), UNLESS the call
 * that threw has already been superseded by a newer call - in that case
 * the error is silently discarded along with the (also discarded) stale
 * result, since the user has already moved on and a newer call's outcome
 * is what should be shown.
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
  const [, startTransition] = useTransition();
  const [isPending, setIsPending] = useState(false);

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
      setIsPending(true);
      startTransition(async () => {
        const result = await guardRef.current.run(() => action(stateRef.current, payload));
        if (result.stale) {
          // A newer call has already superseded this one - don't touch
          // isPending, since that newer call is still the one we're
          // waiting on (or has already cleared it itself).
          return;
        }
        setIsPending(false);
        if (result.error) throw result.error;
        setState(result.value);
      });
    },
    [action]
  );

  return [state, dispatch, isPending];
}

module.exports = { useGuardedActionState };
