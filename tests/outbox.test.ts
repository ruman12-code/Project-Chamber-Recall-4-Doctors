import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The offline buffer, tested away from a browser.
 *
 * What is being checked is the promise the tablet makes to the person
 * holding it: nothing you type is lost when the wifi drops, and nothing
 * is sent out of order or twice in a way that matters.
 */

class FakeStorage {
  private data = new Map<string, string>();
  full = false;
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.full) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void { this.data.delete(key); }
}

const listeners: Record<string, Array<() => void>> = {};
(globalThis as Record<string, unknown>).window = {
  addEventListener: (name: string, fn: () => void) => { (listeners[name] ??= []).push(fn); },
  removeEventListener: () => undefined,
};

let storage: FakeStorage;
beforeEach(() => {
  storage = new FakeStorage();
  (globalThis as Record<string, unknown>).localStorage = storage;
});

/** The tablet's own rule: only a LaptopUnreachableError is worth waiting out. */
class Unreachable extends Error {}

async function makeOutbox(
  send: (path: string, body: unknown) => Promise<void>,
  isUnreachable: (e: unknown) => boolean = () => true,
) {
  const { Outbox } = await import('../src/tablet/outbox');
  return new Outbox(send, isUnreachable);
}

describe('when the laptop can be reached', () => {
  test('what goes in comes straight out', async () => {
    const sent: string[] = [];
    const outbox = await makeOutbox(async (path) => { sent.push(path); });
    outbox.add('/api/intake/answers', { a: 1 });
    await outbox.flush();
    assert.deepEqual(sent, ['/api/intake/answers']);
    assert.equal(outbox.status().pending, 0);
  });

  test('several things go out oldest first', async () => {
    const sent: unknown[] = [];
    const outbox = await makeOutbox(async (_path, body) => { sent.push(body); });
    outbox.add('/api/intake/start', { step: 1 });
    outbox.add('/api/intake/answers', { step: 2 });
    outbox.add('/api/intake/finish', { step: 3 });
    await outbox.flush();
    assert.deepEqual(sent, [{ step: 1 }, { step: 2 }, { step: 3 }]);
  });
});

describe('when the wifi drops', () => {
  test('nothing is lost, and it waits', async () => {
    let offline = true;
    const sent: unknown[] = [];
    const outbox = await makeOutbox(async (_path, body) => {
      if (offline) throw new Error('Failed to fetch');
      sent.push(body);
    });

    outbox.add('/api/intake/answers', { question: 'severity' });
    outbox.add('/api/intake/answers', { question: 'duration' });
    await outbox.flush();

    assert.equal(sent.length, 0);
    assert.equal(outbox.status().pending, 2, 'both answers are still on the tablet');
    assert.ok(outbox.status().offlineSince, 'the tablet knows it is on its own');
  });

  test('and it all goes across when the wifi comes back, in order', async () => {
    let offline = true;
    const sent: unknown[] = [];
    const outbox = await makeOutbox(async (_path, body) => {
      if (offline) throw new Error('Failed to fetch');
      sent.push(body);
    });

    outbox.add('/api/intake/start', { step: 1 });
    outbox.add('/api/intake/answers', { step: 2 });
    await outbox.flush();
    assert.equal(outbox.status().pending, 2);

    offline = false;
    await outbox.flush();
    assert.deepEqual(sent, [{ step: 1 }, { step: 2 }]);
    assert.equal(outbox.status().pending, 0);
    assert.equal(outbox.status().offlineSince, null);
  });

  test('a failure stops the queue rather than skipping past it', async () => {
    // An answer must never arrive before the intake it belongs to.
    let failFirst = true;
    const sent: unknown[] = [];
    const outbox = await makeOutbox(async (_path, body) => {
      if (failFirst && (body as { step: number }).step === 1) throw new Error('Failed to fetch');
      sent.push(body);
    });

    outbox.add('/api/intake/start', { step: 1 });
    outbox.add('/api/intake/answers', { step: 2 });
    await outbox.flush();
    assert.deepEqual(sent, [], 'the second must not go without the first');

    failFirst = false;
    await outbox.flush();
    assert.deepEqual(sent, [{ step: 1 }, { step: 2 }]);
  });

  test('what is waiting survives the tablet being switched off', async () => {
    const outbox = await makeOutbox(async () => { throw new Error('Failed to fetch'); });
    outbox.add('/api/intake/answers', { question: 'severity' });
    await outbox.flush();

    // A new page, a new object, the same tablet: the storage is what
    // carries the work across.
    const reopened = await makeOutbox(async () => { throw new Error('Failed to fetch'); });
    assert.equal(reopened.status().pending, 1);
  });

  test('answers added while a send is in flight are not dropped', async () => {
    // The assistant keeps tapping while the last answer is still going
    // out. Rewriting the whole buffer from a stale copy would lose
    // whatever was added in between.
    const gate: { release?: () => void } = {};
    const sent: unknown[] = [];
    const outbox = await makeOutbox(async (_path, body) => {
      if ((body as { step: number }).step === 1) {
        await new Promise<void>((resolve) => { gate.release = resolve; });
      }
      sent.push(body);
    });

    outbox.add('/api/intake/start', { step: 1 });
    const flushing = outbox.flush();
    await new Promise((resolve) => setTimeout(resolve, 10));
    outbox.add('/api/intake/answers', { step: 2 });
    gate.release?.();
    await flushing;
    await outbox.flush();
    assert.deepEqual(sent, [{ step: 1 }, { step: 2 }]);
  });
});

describe('when the tablet itself has a problem', () => {
  test('a damaged buffer does not stop the tablet working', async () => {
    storage.setItem('chamber-recall.outbox.v1', 'this is not json');
    const outbox = await makeOutbox(async () => undefined);
    assert.equal(outbox.status().pending, 0, 'it starts clean rather than crashing the page');
    outbox.add('/api/intake/answers', { a: 1 });
    assert.equal(outbox.status().pending, 1);
  });

  test('running out of storage is reported, not swallowed', async () => {
    // Losing an answer silently is the one outcome this project refuses.
    const outbox = await makeOutbox(async () => undefined);
    storage.full = true;
    assert.throws(() => outbox.add('/api/intake/answers', { a: 1 }), /run out of storage/);
  });
});

/**
 * The failure that is not a wifi failure.
 *
 * A laptop that ANSWERS and refuses will refuse for ever. Left at the
 * head of the queue it blocks every single thing behind it for the
 * rest of the evening, silently, while the tablet says "laptop not
 * reachable" about a laptop that is answering. That is work quietly
 * not arriving with nobody told, which is the one thing this program
 * must never do.
 */
describe('when the laptop answers and says no', () => {
  const wifi = (e: unknown) => e instanceof Unreachable;

  test('a refusal never blocks what is behind it', async () => {
    const sent: string[] = [];
    const outbox = await makeOutbox(async (path) => {
      if (path === '/api/queue/status') throw new Error('That visit is not on today\u2019s list.');
      sent.push(path);
    }, wifi);
    outbox.add('/api/queue/status', { a: 1 });
    outbox.add('/api/queue/handoff', { b: 2 });
    outbox.add('/api/attachments', { c: 3 });
    await outbox.flush();
    assert.deepEqual(sent, ['/api/queue/handoff', '/api/attachments'],
      'a refusal at the head stopped everything behind it');
    assert.equal(outbox.status().pending, 0);
  });

  test('and it is kept, in words, for somebody to read', async () => {
    const outbox = await makeOutbox(async () => {
      throw new Error('That visit is no longer on the list.');
    }, wifi);
    outbox.add('/api/queue/status', { visitId: 'v1' });
    await outbox.flush();
    const refused = outbox.status().refused;
    assert.equal(refused.length, 1);
    assert.equal(refused[0]!.path, '/api/queue/status');
    assert.deepEqual(refused[0]!.body, { visitId: 'v1' });
    assert.equal(refused[0]!.reason, 'That visit is no longer on the list.');
    assert.equal(outbox.status().pending, 0, 'a refused entry was left in the queue as well');
  });

  test('it is not retried, however many times the outbox runs', async () => {
    let tries = 0;
    const outbox = await makeOutbox(async () => { tries += 1; throw new Error('no'); }, wifi);
    outbox.add('/api/queue/status', {});
    await outbox.flush();
    await outbox.flush();
    await outbox.flush();
    assert.equal(tries, 1);
    assert.equal(outbox.status().refused.length, 1);
  });

  test('it goes only when a person says they have read it', async () => {
    const outbox = await makeOutbox(async () => { throw new Error('no'); }, wifi);
    outbox.add('/api/queue/status', {});
    await outbox.flush();
    const [one] = outbox.status().refused;
    assert.ok(one);
    await outbox.flush();
    assert.equal(outbox.status().refused.length, 1, 'a refusal cleared itself');
    outbox.dismissRefused(one.id);
    assert.equal(outbox.status().refused.length, 0);
  });

  test('a refusal does NOT make the tablet say the laptop is unreachable', async () => {
    const outbox = await makeOutbox(async () => { throw new Error('no'); }, wifi);
    outbox.add('/api/queue/status', {});
    await outbox.flush();
    assert.equal(outbox.status().offlineSince, null,
      'the tablet blamed the wifi for a laptop that answered');
  });

  // The other half of the same rule, and getting it wrong the other way
  // would be worse: an entry set aside for a wifi blip is work that
  // never arrives.
  test('being out of reach still waits, and still holds the order', async () => {
    let reachable = false;
    const sent: string[] = [];
    const outbox = await makeOutbox(async (path) => {
      if (!reachable) throw new Unreachable('the laptop could not be reached');
      sent.push(path);
    }, wifi);
    outbox.add('/api/intake/start', {});
    outbox.add('/api/intake/answers', {});
    await outbox.flush();
    assert.equal(outbox.status().pending, 2, 'a wifi drop threw work away');
    assert.equal(outbox.status().refused.length, 0);
    assert.notEqual(outbox.status().offlineSince, null);
    reachable = true;
    await outbox.flush();
    assert.deepEqual(sent, ['/api/intake/start', '/api/intake/answers']);
    assert.equal(outbox.status().offlineSince, null);
  });
});
