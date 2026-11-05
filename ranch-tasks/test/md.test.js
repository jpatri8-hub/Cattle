import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGuide, parseFollowups } from '../public/md.js';

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

test('follow-ups take the heading above them as the place', () => {
  const g = 'Intro\n\n## Sharpers\n[ ] Needs hay -> Put out hay\n[ ] Needs mineral -> Put out mineral\n## Horse field\n[ ] Needs hay -> Put out hay\n- Checked';
  const f = parseFollowups(g);
  assert.deepEqual(f.map((x) => x.todo), ['Put out hay – Sharpers', 'Put out mineral – Sharpers', 'Put out hay – Horse field']);
  assert.deepEqual(f.map((x) => x.index), [0, 1, 2]);
  const html = renderGuide(g, { checklist: true });
  assert.equal((html.match(/data-followup=/g) || []).length, 3);
  assert.equal((html.match(/data-step=/g) || []).length, 1);
});

test('follow-up text is escaped', () => {
  const html = renderGuide('## <b>x</b>\n[ ] Needs <img src=x> -> Put <script>', { checklist: true });
  assert.ok(!html.includes('<img') && !html.includes('<script') && !html.includes('<b>'));
});

test('stop headings get their own tick-box and still name follow-ups', () => {
  const g = '## [ ] Sharpers\n[ ] Needs hay -> Put out hay\n## [ ] Church field';
  const f = parseFollowups(g);
  assert.equal(f[0].where, 'Sharpers');
  assert.equal(f[0].action, 'Put out hay');
  const html = renderGuide(g, { checklist: true });
  assert.equal((html.match(/class="stop"/g) || []).length, 2);
  assert.equal((html.match(/data-step=/g) || []).length, 2);
});
