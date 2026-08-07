/**
 * Level-resolution check for server/log.js.
 * Run: node --test server/log.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLevel } from './log.js';

test('defaults to info when nothing is set', () => {
  assert.equal(resolveLevel({}), 'info');
});

test('SAAVN_DEBUG shortcut turns on debug', () => {
  assert.equal(resolveLevel({ SAAVN_DEBUG: '1' }), 'debug');
  assert.equal(resolveLevel({ SAAVN_DEBUG: 'true' }), 'debug');
  assert.equal(resolveLevel({ SAAVN_DEBUG: 'false' }), 'info');
});

test('explicit SAAVN_LOG_LEVEL wins and is case/space insensitive', () => {
  assert.equal(resolveLevel({ SAAVN_LOG_LEVEL: 'warn' }), 'warn');
  assert.equal(resolveLevel({ SAAVN_LOG_LEVEL: ' ERROR ' }), 'error');
  // explicit level overrides the SAAVN_DEBUG shortcut
  assert.equal(resolveLevel({ SAAVN_LOG_LEVEL: 'warn', SAAVN_DEBUG: '1' }), 'warn');
});

test('an invalid level falls back (to debug via shortcut, else info)', () => {
  assert.equal(resolveLevel({ SAAVN_LOG_LEVEL: 'verbose' }), 'info');
  assert.equal(resolveLevel({ SAAVN_LOG_LEVEL: 'nonsense', SAAVN_DEBUG: '1' }), 'debug');
});
