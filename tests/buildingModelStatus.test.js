// tests/buildingModelStatus.test.js
// F3A — status transition rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStatus } from '../lib/buildingModelStatus.js';

test('review transitions', () => {
  assert.deepEqual(nextStatus('review', 'draft'), { ok: true, status: 'needs_review' });
  assert.deepEqual(nextStatus('review', 'needs_review'), { ok: true, status: 'needs_review' });
  assert.equal(nextStatus('review', 'approved').ok, false);
});

test('approve transitions', () => {
  assert.deepEqual(nextStatus('approve', 'draft'), { ok: true, status: 'approved' });
  assert.deepEqual(nextStatus('approve', 'needs_review'), { ok: true, status: 'approved' });
  assert.equal(nextStatus('approve', 'approved').ok, false);   // already approved
});

test('supersede transitions', () => {
  assert.deepEqual(nextStatus('supersede', 'approved'), { ok: true, status: 'superseded' });
  assert.deepEqual(nextStatus('supersede', 'draft'), { ok: true, status: 'superseded' }); // discard
});

test('superseded is terminal; unknown inputs rejected', () => {
  assert.equal(nextStatus('approve', 'superseded').ok, false);
  assert.equal(nextStatus('bogus', 'draft').ok, false);
  assert.equal(nextStatus('approve', 'bogus').ok, false);
});
