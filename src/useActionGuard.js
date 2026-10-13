'use strict';

const { useRef, useCallback, useEffect } = require('react');
const { createActionGuard } = require('./createActionGuard');

/**
 * Low-level hook for when you're managing useOptimistic/useTransition
 * yourself and just need the sequencing guard as a building block.
 *
 * const { guard } = useActionGuard();
 *
 * function handleClick() {
 *   setOptimisticLiked(!liked); // your own optimistic update
 *   startTransition(async () => {
 *     const result = await guard(toggleLikeAction(id));
 *     if (result.stale) return; // a newer click already superseded this
 *     if (result.error) throw result.error;
 *     setLiked(result.value);
 *   });
 * }
 *
 * Automatically invalidates in-flight calls on unmount, so a response
 * that resolves after the component is gone can't do anything - there's
 * nothing left to call it on, but this also means any code you write
 * after `await guard(...)` correctly sees `stale: true` instead of running.
 */
function useActionGuard() {
  const guardRef = useRef(null);
  if (guardRef.current === null) {
    guardRef.current = createActionGuard();
  }

  const guard = useCallback((promiseOrFactory) => guardRef.current.run(promiseOrFactory), []);
  const invalidate = useCallback(() => guardRef.current.invalidate(), []);

  useEffect(() => {
    return () => {
      guardRef.current.invalidate();
    };
  }, []);

  return { guard, invalidate };
}

module.exports = { useActionGuard };
