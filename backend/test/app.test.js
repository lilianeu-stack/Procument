import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';

process.env.JWT_SECRET = 'test-secret-with-at-least-thirty-two-characters';
let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('health endpoint is public', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('protected API rejects requests without a token', async () => {
  const response = await fetch(`${baseUrl}/auth/me`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).message, 'Sign in to continue.');
});

test('admin endpoints reject non-admin roles before database access', async () => {
  const token = jwt.sign({ id: 1, role: 'requestor' }, process.env.JWT_SECRET);
  const response = await fetch(`${baseUrl}/admin/users`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 403);
});

test('requisition validation returns a client error for an empty request', async () => {
  const token = jwt.sign({ id: 1, role: 'requestor' }, process.env.JWT_SECRET);
  const response = await fetch(`${baseUrl}/requisitions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(response.status, 400);
});
