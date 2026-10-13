'use strict';

/**
 * Framework-agnostic sequence guard. No React dependency - this is the
 * actual mechanism; the hooks in this package are thin wrappers around it.
 *
 * THE PROBLEM THIS SOLVES:
 * When you fire an async call (a Server Action, a fetch, anything) more
 * than once before the first one finishes - a double-click, a fast typist
 * re-triggering a search, a user navigating back and retriggering a
 * submit - the calls can resolve OUT OF ORDER. Whichever one finishes
 * LAST wins, even if it was started FIRST. That means a slow response to
 * an old click can silently overwrite the UI with stale data after a
 * newer, faster response already rendered the correct thing.
 *
 * THE FIX:
 * Every call to guard.run(...) is tagged with an incrementing token. When
 * a call resolves, it checks whether a NEWER call has been started since
 * it began. If so, it reports itself as `stale` instead of handing back a
 * value you might be tempted to apply to state anyway.
 *
 * WHAT THIS DOES NOT DO:
 * This does not cancel the underlying work. A Next.js Server Action has
 * no public API to actually abort server-side execution once invoked, so
 * a stale call's network request and server-side execution still run to
 * completion - this only stops you from ACTING on its result once it's
 * no longer the latest. If the underlying call accepts an AbortSignal
 * (e.g. a plain fetch), pass one yourself; this guard doesn't create or
 * manage one for you, since Server Actions typically can't use it anyway.
 */
function createActionGuard() {
  let token = 0;

  /**
   * Run a promise (or a function that returns one) under the guard.
   * Always resolves - never rejects - with a result descriptor, so you
   * don't need a try/catch just to find out whether to ignore it.
   *
   * @param {Promise|(() => Promise)} promiseOrFactory
   * @returns {Promise<{stale: boolean, value: *, error: *}>}
   */
  function run(promiseOrFactory) {
    const myToken = ++token;
    let promise;
    try {
      promise = typeof promiseOrFactory === 'function' ? promiseOrFactory() : promiseOrFactory;
    } catch (syncError) {
      // A factory that throws synchronously (e.g. an action that validates
      // its input before doing anything async) must still honor the "never
      // rejects" contract below - without this catch, that throw would
      // escape run() directly instead of coming back as a result descriptor.
      //
      // The staleness check is deferred to a microtask via .then() rather
      // than computed inline, on purpose: if this call and another run()
      // call both happen synchronously in the same tick (a common pattern -
      // see the test for this), the token comparison must happen AFTER all
      // synchronous code in that tick has run, same as the normal async
      // path below already does naturally. Computing it inline here would
      // run too early and could wrongly report `stale: false`.
      return Promise.resolve().then(() => ({
        stale: myToken !== token,
        value: undefined,
        error: syncError,
      }));
    }

    return Promise.resolve(promise).then(
      (value) => ({ stale: myToken !== token, value, error: undefined }),
      (error) => ({ stale: myToken !== token, value: undefined, error })
    );
  }

  /** Force everything currently in flight to be treated as stale when it
   * resolves, without starting a new call yourself. Useful on unmount, or
   * when you want to explicitly cancel-in-spirit (e.g. the user navigated
   * away from the form). */
  function invalidate() {
    token += 1;
  }

  /** The current latest token - mostly useful for tests/debugging. */
  function getToken() {
    return token;
  }

  return { run, invalidate, getToken };
}

module.exports = { createActionGuard };
