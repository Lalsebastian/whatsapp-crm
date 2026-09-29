import test from 'node:test';
import assert from 'node:assert/strict';
import { initialRole, roleHome } from '../../src/lib/roles.js';
import { normaliseTheme, resolveTheme, toggledTheme } from '../../src/lib/theme-utils.js';

test('role switching maps every mock role to its matching route', () => {
  assert.equal(roleHome('owner'), '/owner');
  assert.equal(roleHome('agent'), '/agent');
  assert.equal(roleHome('tech'), '/tech');
});

test('mock stored roles are development-only', () => {
  assert.equal(initialRole({ isDev: true, storedRole: 'agent' }), 'agent');
  assert.equal(initialRole({ isDev: false, storedRole: 'agent' }), 'owner');
  assert.equal(initialRole({ isDev: true, storedRole: 'invalid' }), 'owner');
});

test('theme switching resolves system state and toggles the shared value', () => {
  assert.equal(normaliseTheme('unknown'), 'system');
  assert.equal(resolveTheme('system', 'dark'), 'dark');
  assert.equal(toggledTheme('dark'), 'light');
  assert.equal(toggledTheme('light'), 'dark');
});
