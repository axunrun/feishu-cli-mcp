import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRisk, needsConfirm } from './cli.js';

test('classifies read-only helpers as safe', () => {
  assert.equal(classifyRisk(['schema', 'calendar.events.list'], 'schema'), 'read_only');
  assert.equal(classifyRisk(['calendar', '+agenda'], 'read'), 'read_only');
});

test('requires confirmation for side-effect intents', () => {
  assert.equal(needsConfirm('write'), true);
  assert.equal(needsConfirm('auth_config'), true);
  assert.equal(needsConfirm('read'), false);
});

test('marks raw POST API as write risk', () => {
  assert.equal(classifyRisk(['api', 'POST', '/open-apis/im/v1/messages'], 'write'), 'open_api_write');
});
