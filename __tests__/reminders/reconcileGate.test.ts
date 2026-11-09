import {
  holdReconcile,
  onReconcileReleased,
  resetReconcileGateForTests,
  runReconcile,
} from '../../src/reminders/reconcileGate';

const tick = () => new Promise<void>(r => setTimeout(() => r(), 5));

afterEach(() => resetReconcileGateForTests());

describe('reconcile gate (restore, spec §8.7)', () => {
  test('a hold waits for the reconcile already running', async () => {
    let finish!: () => void;
    const order: string[] = [];
    const running = runReconcile(
      () =>
        new Promise<void>(r => {
          finish = () => {
            order.push('reconcile done');
            r();
          };
        }),
    );
    const held = holdReconcile().then(release => {
      order.push('held');
      return release;
    });
    await tick();
    expect(order).toEqual([]);
    finish();
    await running;
    const release = await held;
    expect(order).toEqual(['reconcile done', 'held']);
    release();
  });

  test('reconciles requested while held wait, then run; listeners hear the release', async () => {
    const release = await holdReconcile();
    const heard = jest.fn();
    onReconcileReleased(heard);
    const ran = jest.fn(async () => 'ok');
    const waiting = runReconcile(ran);
    await tick();
    expect(ran).not.toHaveBeenCalled();
    release();
    release(); // idempotent
    await expect(waiting).resolves.toBe('ok');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test('a failing reconcile still lets a hold through', async () => {
    await expect(
      runReconcile(async () => {
        throw new Error('sync failed');
      }),
    ).rejects.toThrow('sync failed');
    const release = await holdReconcile();
    release();
  });
});
