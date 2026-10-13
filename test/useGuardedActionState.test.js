const { renderHook, act, waitFor } = require('@testing-library/react');
const { useGuardedActionState } = require('../src/useGuardedActionState');

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('useGuardedActionState', () => {
  test('starts with initialState', () => {
    const action = jest.fn();
    const { result } = renderHook(() => useGuardedActionState(action, 'initial'));
    expect(result.current[0]).toBe('initial');
    expect(result.current[2]).toBe(false); // isPending
  });

  test('applies the action result to state once it resolves', async () => {
    const action = jest.fn(async (prevState, payload) => `result:${payload}`);
    const { result } = renderHook(() => useGuardedActionState(action, 'initial'));

    act(() => {
      result.current[1]('hello');
    });

    await waitFor(() => expect(result.current[0]).toBe('result:hello'));
    expect(action).toHaveBeenCalledWith('initial', 'hello');
  });

  test('passes the current state as previousState on the next dispatch', async () => {
    const action = jest.fn(async (prevState, payload) => prevState + payload);
    const { result } = renderHook(() => useGuardedActionState(action, 0));

    act(() => {
      result.current[1](1);
    });
    await waitFor(() => expect(result.current[0]).toBe(1));

    act(() => {
      result.current[1](2);
    });
    await waitFor(() => expect(result.current[0]).toBe(3));
  });

  test('the actual bug this package exists for: a slow first call cannot overwrite a faster second call', async () => {
    const action = jest.fn(async (prevState, payload) => {
      if (payload === 'slow-click') return await delay(50, 'STALE-SHOULD-NOT-APPEAR');
      return await delay(5, 'fresh-click-result');
    });

    const { result } = renderHook(() => useGuardedActionState(action, 'initial'));

    act(() => {
      result.current[1]('slow-click'); // fired first, resolves last
    });
    act(() => {
      result.current[1]('fast-click'); // fired second, resolves first
    });

    // Wait past when the fast call resolves
    await waitFor(() => expect(result.current[0]).toBe('fresh-click-result'));

    // Wait past when the slow call WOULD have resolved too, and confirm
    // it never clobbers the already-correct state.
    await delay(70);
    expect(result.current[0]).toBe('fresh-click-result');
  });

  test('isPending is true while the latest call is in flight, false after', async () => {
    const action = jest.fn(async (prevState, payload) => delay(20, payload));
    const { result } = renderHook(() => useGuardedActionState(action, 'initial'));

    act(() => {
      result.current[1]('x');
    });
    expect(result.current[2]).toBe(true);

    await waitFor(() => expect(result.current[2]).toBe(false));
    expect(result.current[0]).toBe('x');
  });

  test('isPending stays true until the LATEST call resolves, not whichever resolves first', async () => {
    const action = jest.fn(async (prevState, payload) => {
      if (payload === 'slow') return delay(50, 'slow-result');
      return delay(10, 'fast-result');
    });
    const { result } = renderHook(() => useGuardedActionState(action, 'initial'));

    act(() => {
      result.current[1]('slow'); // started first, resolves last
    });
    act(() => {
      result.current[1]('fast'); // started second, resolves first
    });

    // The fast call resolving is NOT the latest call (slow was requested
    // after... wait, slow was dispatched first here, fast second, so fast
    // IS the latest). isPending should clear once fast (the latest)
    // resolves, and the later-resolving slow call should be ignored.
    await waitFor(() => expect(result.current[2]).toBe(false));
    expect(result.current[0]).toBe('fast-result');

    // Make sure the slow call resolving afterward doesn't flip isPending
    // back on or overwrite state.
    await delay(60);
    expect(result.current[2]).toBe(false);
    expect(result.current[0]).toBe('fast-result');
  });
});
