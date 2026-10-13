const { createActionGuard } = require('../src/createActionGuard');

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function delayReject(ms, error) {
  return new Promise((_, reject) => setTimeout(() => reject(error), ms));
}

describe('createActionGuard', () => {
  test('a single call resolves fresh (not stale)', async () => {
    const guard = createActionGuard();
    const result = await guard.run(delay(10, 'A'));
    expect(result).toEqual({ stale: false, value: 'A', error: undefined });
  });

  test('the classic bug: slow call started first, resolves last -> reported stale', async () => {
    const guard = createActionGuard();

    // Call 1 starts first but is slow (simulates a laggy response to an
    // earlier click).
    const call1 = guard.run(delay(50, 'stale-result'));
    // Call 2 starts second but resolves fast (simulates a newer click
    // whose response comes back first).
    const call2 = guard.run(delay(5, 'fresh-result'));

    const [result1, result2] = await Promise.all([call1, call2]);

    // call2 is the latest call and finished - not stale.
    expect(result2).toEqual({ stale: false, value: 'fresh-result', error: undefined });
    // call1 is superseded by call2 having started after it - stale,
    // even though in real time it was fired first.
    expect(result1.stale).toBe(true);
  });

  test('three rapid calls - only the last one is ever non-stale', async () => {
    const guard = createActionGuard();

    const results = await Promise.all([
      guard.run(delay(30, 'first')),
      guard.run(delay(20, 'second')),
      guard.run(delay(10, 'third')),
    ]);

    expect(results[0].stale).toBe(true);
    expect(results[1].stale).toBe(true);
    expect(results[2]).toEqual({ stale: false, value: 'third', error: undefined });
  });

  test('sequential calls (one at a time, no overlap) are never stale', async () => {
    const guard = createActionGuard();

    const r1 = await guard.run(delay(5, 'one'));
    const r2 = await guard.run(delay(5, 'two'));
    const r3 = await guard.run(delay(5, 'three'));

    expect(r1.stale).toBe(false);
    expect(r2.stale).toBe(false);
    expect(r3.stale).toBe(false);
  });

  test('never rejects - a rejected promise resolves to a result descriptor with .error', async () => {
    const guard = createActionGuard();
    const err = new Error('boom');
    const result = await guard.run(delayReject(5, err));
    expect(result.stale).toBe(false);
    expect(result.error).toBe(err);
    expect(result.value).toBeUndefined();
  });

  test('a stale call that rejects is still reported stale (error present but caller should ignore it)', async () => {
    const guard = createActionGuard();
    const err = new Error('old request failed');

    const staleCall = guard.run(delayReject(30, err));
    const freshCall = guard.run(delay(5, 'fresh'));

    const [staleResult, freshResult] = await Promise.all([staleCall, freshCall]);

    expect(staleResult.stale).toBe(true);
    expect(staleResult.error).toBe(err);
    expect(freshResult).toEqual({ stale: false, value: 'fresh', error: undefined });
  });

  test('accepts a factory function instead of a promise, and only invokes it when run() is called', async () => {
    const guard = createActionGuard();
    let invoked = false;
    const factory = () => {
      invoked = true;
      return delay(5, 'from-factory');
    };

    expect(invoked).toBe(false);
    const result = await guard.run(factory);
    expect(invoked).toBe(true);
    expect(result).toEqual({ stale: false, value: 'from-factory', error: undefined });
  });

  test('invalidate() marks the currently in-flight call stale even with no new call', async () => {
    const guard = createActionGuard();
    const pending = guard.run(delay(20, 'value'));
    guard.invalidate();
    const result = await pending;
    expect(result.stale).toBe(true);
  });

  test('getToken() increments once per run() call', () => {
    const guard = createActionGuard();
    expect(guard.getToken()).toBe(0);
    guard.run(Promise.resolve('x'));
    expect(guard.getToken()).toBe(1);
    guard.run(Promise.resolve('y'));
    expect(guard.getToken()).toBe(2);
  });

  test('a factory that throws synchronously resolves to an error descriptor, not an escaping throw', async () => {
    const guard = createActionGuard();
    const syncError = new Error('validation failed before anything async happened');
    const factory = () => {
      throw syncError; // no promise ever created - throws immediately
    };

    // Must not throw - run() promises to always resolve.
    const result = await guard.run(factory);
    expect(result.stale).toBe(false);
    expect(result.error).toBe(syncError);
    expect(result.value).toBeUndefined();
  });

  test('a synchronous throw still participates in staleness like any other call', async () => {
    const guard = createActionGuard();
    const syncThrowingFactory = () => {
      throw new Error('old, now-superseded validation error');
    };

    const staleCall = guard.run(syncThrowingFactory);
    const freshCall = guard.run(delay(5, 'fresh'));

    const [staleResult, freshResult] = await Promise.all([staleCall, freshCall]);
    expect(staleResult.stale).toBe(true);
    expect(freshResult).toEqual({ stale: false, value: 'fresh', error: undefined });
  });

  test('preserves error identity (e.g. Next.js redirect()/notFound() special errors survive unchanged)', async () => {
    // Next's redirect()/notFound() work by throwing an error object tagged
    // with a special `digest` property that Next's own framework code
    // checks for further up the call stack. A wrapper that clones, wraps,
    // or re-creates the error instead of passing the SAME object through
    // would silently break redirect()/notFound() for anyone using this
    // package. This test simulates that shape and checks object identity.
    const guard = createActionGuard();
    const redirectError = new Error('NEXT_REDIRECT');
    redirectError.digest = 'NEXT_REDIRECT;push;/somewhere;307;';

    const result = await guard.run(Promise.reject(redirectError));
    expect(result.error).toBe(redirectError); // same object, not a copy
    expect(result.error.digest).toBe('NEXT_REDIRECT;push;/somewhere;307;');
  });

  test('multiple independent guards do not interfere with each other', async () => {
    const guardA = createActionGuard();
    const guardB = createActionGuard();

    const slowA = guardA.run(delay(30, 'A-slow'));
    const fastA = guardA.run(delay(5, 'A-fast'));
    const onlyB = guardB.run(delay(10, 'B-only'));

    const [slowAResult, fastAResult, onlyBResult] = await Promise.all([slowA, fastA, onlyB]);

    expect(slowAResult.stale).toBe(true);
    expect(fastAResult.stale).toBe(false);
    expect(onlyBResult.stale).toBe(false); // guardB only ever had one call
  });
});
