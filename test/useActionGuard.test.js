const React = require('react');
const { renderHook, act } = require('@testing-library/react');
const { useActionGuard } = require('../src/useActionGuard');

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('useActionGuard', () => {
  test('returns a guard function and an invalidate function', () => {
    const { result } = renderHook(() => useActionGuard());
    expect(typeof result.current.guard).toBe('function');
    expect(typeof result.current.invalidate).toBe('function');
  });

  test('guard reference is stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useActionGuard());
    const firstGuard = result.current.guard;
    rerender();
    expect(result.current.guard).toBe(firstGuard);
  });

  test('reports a stale result when superseded by a newer call', async () => {
    const { result } = renderHook(() => useActionGuard());

    let staleResult, freshResult;
    await act(async () => {
      const staleCall = result.current.guard(delay(30, 'old'));
      const freshCall = result.current.guard(delay(5, 'new'));
      [staleResult, freshResult] = await Promise.all([staleCall, freshCall]);
    });

    expect(staleResult.stale).toBe(true);
    expect(freshResult).toEqual({ stale: false, value: 'new', error: undefined });
  });

  test('invalidates in-flight calls on unmount', async () => {
    const { result, unmount } = renderHook(() => useActionGuard());

    const pending = result.current.guard(delay(20, 'value'));
    unmount();

    const outcome = await pending;
    expect(outcome.stale).toBe(true);
  });
});
