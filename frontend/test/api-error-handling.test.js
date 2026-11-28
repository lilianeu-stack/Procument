import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, setApiErrorHandler, setApiSuccessHandler } from '../src/services/api.js';

const original = {
  fetch: globalThis.fetch,
  window: globalThis.window,
  localStorage: globalThis.localStorage
};

let errors;
let successes;
let calls;
let store;

beforeEach(() => {
  errors = [];
  successes = [];
  calls = [];
  store = new Map([['pims-token', 'test-token']]);
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  globalThis.window = {
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id)
  };
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return { ok: true, status: 200, json: async () => ({ ok: true }), headers: { get: () => null } };
  };
  setApiErrorHandler((error) => errors.push(error));
  setApiSuccessHandler((path, method) => successes.push({ path, method }));
});

afterEach(() => {
  setApiErrorHandler(null);
  setApiSuccessHandler(null);
  globalThis.fetch = original.fetch;
  if (original.window === undefined) delete globalThis.window;
  else globalThis.window = original.window;
  if (original.localStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = original.localStorage;
});

test('network failure becomes a reported error with request path and method', async () => {
  globalThis.fetch = async (...args) => {
    calls.push(args);
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(
    () => api('/suppliers', { method: 'POST', body: JSON.stringify({ name: 'QA' }) }),
    (error) => {
      assert.equal(error.code, 'NETWORK_ERROR');
      assert.equal(error.status, 0);
      assert.equal(error.path, '/suppliers');
      assert.equal(error.method, 'POST');
      assert.equal(error.reported, true);
      assert.match(error.message, /Cannot reach the server/);
      return true;
    }
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, '/suppliers');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-token');
});

test('aborted request becomes a timeout error instead of a network error', async () => {
  globalThis.window.setTimeout = (fn) => { fn(); return 1; };
  globalThis.fetch = async (...args) => {
    calls.push(args);
    assert.equal(args[1].signal.aborted, true);
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  await assert.rejects(() => api('/slow-report'), (error) => {
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.status, 408);
    assert.match(error.message, /too long to respond/);
    assert.equal(error.reported, true);
    return true;
  });
  assert.equal(errors.length, 1);
});

test('HTTP failure exposes only the safe backend message and request id', async () => {
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return {
      ok: false,
      status: 400,
      json: async () => ({ message: 'Add at least one item to the request.', requestId: 'req-42' }),
      headers: { get: () => 'req-42' }
    };
  };
  await assert.rejects(() => api('/portal/requester/requisitions', { method: 'POST' }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.requestId, 'req-42');
    assert.equal(error.message, 'Add at least one item to the request.');
    assert.equal(error.reported, true);
    return true;
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].requestId, 'req-42');
});

test('suppressed requests still reject but do not create duplicate user-facing errors', async () => {
  globalThis.fetch = async (...args) => {
    calls.push(args);
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(() => api('/notifications', {
    method: 'POST', body: '{}', suppressGlobalError: true
  }));
  assert.equal(errors.length, 0);
});

test('successful requests invoke the success hook exactly once', async () => {
  const data = await api('/sidebar-counts');
  assert.deepEqual(data, { ok: true });
  assert.deepEqual(successes, [{ path: '/sidebar-counts', method: 'GET' }]);
  assert.equal(errors.length, 0);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-token');
});
