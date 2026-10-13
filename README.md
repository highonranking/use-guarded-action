# use-guarded-action

Stop stale Server Action responses from overwriting fresher state.

```js
const [likes, toggleLike, isPending] = useGuardedActionState(toggleLikeAction, initialLikes);
```

## The bug this exists for

You've got a like button wired up with `useOptimistic` and a Server
Action. Someone double-clicks it, or clicks it five times fast, or clicks
it and immediately navigates away and back. Each click fires a real
request. Those requests don't necessarily **resolve** in the order they
were **sent** - the network doesn't guarantee that, and neither does your
server's response time under load.

So: click 1 is slow (maybe it hit a cold server instance). Click 2 is
fast. Click 2's response arrives first and correctly updates your UI.
Then click 1's response arrives *after* - and silently overwrites the
correct state with stale data, because nothing told your code that a
newer, better answer had already won.

This is a real, current problem - not a hypothetical. [People are hitting
it on recent Next.js versions right now](https://dev.to/shubhradev/my-nextjs-16-optimistic-ui-looked-perfect-then-someone-clicked-it-five-times-fast-b2c).
React Router has a whole documented concept for this class of bug
("[race conditions](https://reactrouter.com/explanation/race-conditions)," "[network concurrency management](https://reactrouter.com/explanation/concurrency)")
because it's common enough to need a name - but that solution lives
inside React Router's own loader/action system. Plain Next.js App Router
Server Actions have no equivalent built-in, and there wasn't an npm
package for it. Now there is.

## Install

```bash
npm install use-guarded-action
```

Peer dependency: `react ^18.0.0 || ^19.0.0`. Works with Next.js App
Router Server Actions, or honestly any async call you fire more than once
before the first resolves - Server Actions are just the motivating case.

## The easy way: `useGuardedActionState`

Shaped identically to React's own built-in `useActionState`, on purpose -
if you already know that hook, you already know this one.

```js
'use client';
import { useGuardedActionState } from 'use-guarded-action';
import { toggleLikeAction } from './actions';

function LikeButton({ postId, initialLikes }) {
  const [likes, toggleLike, isPending] = useGuardedActionState(
    toggleLikeAction, // (previousState, payload) => Promise<newState>
    initialLikes
  );

  return (
    <button disabled={isPending} onClick={() => toggleLike(postId)}>
      {likes} likes
    </button>
  );
}
```

That's it. Click it ten times fast - only the result of the *last* click
you made ever lands in `likes`. Every earlier, now-superseded response is
silently discarded instead of flickering the UI backward.

`action` receives `(previousState, payload)`, same signature real
Server Actions written for `useActionState` already use - this is meant
to be a near drop-in swap, not a rewrite.

## The flexible way: `useActionGuard`

If you're managing `useOptimistic`/`useTransition` yourself and just want
the sequencing primitive:

```js
'use client';
import { useOptimistic, useTransition } from 'react';
import { useActionGuard } from 'use-guarded-action';
import { toggleLikeAction } from './actions';

function LikeButton({ postId, liked, likeCount }) {
  const { guard } = useActionGuard();
  const [, startTransition] = useTransition();
  const [optimisticLiked, setOptimisticLiked] = useOptimistic(liked);

  function handleClick() {
    setOptimisticLiked((prev) => !prev);
    startTransition(async () => {
      const result = await guard(toggleLikeAction(postId));
      if (result.stale) return; // a newer click already superseded this
      if (result.error) throw result.error;
      // apply result.value to your real state here
    });
  }

  return <button onClick={handleClick}>{optimisticLiked ? 'liked' : likeCount}</button>;
}
```

`guard(promise)` never rejects - it always resolves to
`{ stale, value, error }` so you don't need a try/catch just to check
whether to ignore the result.

## The framework-agnostic core: `createActionGuard`

No React dependency at all - if you want the sequencing logic somewhere
that isn't a React component (a vanilla event handler, a different
framework), this is the actual mechanism both hooks above are built on:

```js
import { createActionGuard } from 'use-guarded-action';

const guard = createActionGuard();

async function handleSearch(query) {
  const result = await guard.run(searchApi(query));
  if (result.stale) return; // a newer search already superseded this
  renderResults(result.value);
}
```

## What this does NOT do

**This does not cancel the underlying work.** Next.js Server Actions have
no public API to actually abort server-side execution once invoked - the
superseded request's network round-trip and server-side execution still
run to completion. This package only stops you from *acting* on that
result once it's no longer the latest; it doesn't stop the server from
doing the work, and it doesn't save you the network request. If your
underlying call is a plain `fetch` that accepts an `AbortSignal`, you can
add real cancellation yourself alongside this - this package doesn't set
that up for you, since Server Actions typically have nowhere to plug an
`AbortSignal` into anyway.

**This does not deduplicate identical calls** - firing the same action
with the same payload three times still fires it three times. It only
guarantees that whichever one is *latest* is the one that wins, not that
redundant ones are prevented from being sent.

## How it works, briefly

Every call is tagged with an incrementing token when it starts. When it
resolves, it checks whether a newer call has started since - if so, it
reports itself as stale instead of handing back a value you might apply
to state anyway. See `src/createActionGuard.js` for the ~30 lines that
actually do this; it's intentionally small enough to read in one sitting
and vendor into your own code if you don't want the dependency.

## Contributing

Issues and PRs welcome - especially real-world cases where the
stale/latest semantics don't match what you'd expect, since getting that
exactly right is the entire point of this package.

## License

MIT
