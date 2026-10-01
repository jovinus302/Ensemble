import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { stopOwnedChildren, trackOwnedChild } from '../src/local.ts';

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
  });
  return { child, process: child as unknown as ChildProcess };
}

it('finishes cleanup when an aborted server closed by signal before cleanup began', async () => {
  const { child, process } = fakeChild();
  const tracked = trackOwnedChild(process);
  child.signalCode = 'SIGTERM'; child.emit('close', null, 'SIGTERM');
  // Native driver teardown may finish later; signal termination leaves exitCode null.
  await stopOwnedChildren([tracked]);
  expect(child.kill).not.toHaveBeenCalled();
  expect(child.listenerCount('close')).toBe(0);
});

it('registers completion before kill and handles an immediate close event', async () => {
  const { child, process } = fakeChild();
  child.kill.mockImplementation(() => { child.signalCode = 'SIGTERM'; child.emit('close', null, 'SIGTERM'); return true; });
  await stopOwnedChildren([trackOwnedChild(process)]);
  expect(child.kill).toHaveBeenCalledOnce();
});

it('does not confuse signal sent or process exit with drained stdio close', async () => {
  const { child, process } = fakeChild();
  const tracked = trackOwnedChild(process);
  let finished = false;
  const pending = stopOwnedChildren([tracked]).then(() => { finished = true; });
  child.signalCode = 'SIGTERM'; child.emit('exit', null, 'SIGTERM');
  await Promise.resolve(); expect(finished).toBe(false);
  child.emit('close', null, 'SIGTERM'); await pending;
  expect(finished).toBe(true);
});

it('accepts an already terminated child and does not signal it again', async () => {
  for (const signaled of [true, false]) {
    const { child, process } = fakeChild();
    if (signaled) child.signalCode = 'SIGTERM'; else child.exitCode = 0;
    await stopOwnedChildren([trackOwnedChild(process)]);
    expect(child.kill).not.toHaveBeenCalled();
  }
});
