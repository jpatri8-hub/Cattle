import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGuide } from '../public/md.js';

test('guide text is escaped (no HTML injection)', () => {
  const html = renderGuide('1. step <script>alert(1)</script>\n[x](javascript:alert(1))\n<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript'));
});

test('headings, steps, warnings and checklists', () => {
  const html = renderGuide('## Hookup\n1. Left arm first\n2. Right arm\n! Engine off\n- grease', { checklist: true });
  assert.match(html, /<h4>Hookup<\/h4>/);
  assert.match(html, /<ol class="checklist">/);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 3);
  assert.match(html, /class="warn"/);
});
