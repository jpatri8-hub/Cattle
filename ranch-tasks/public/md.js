// Tiny, safe Markdown-ish renderer for guides. Everything is HTML-escaped
// first, so guide text can never inject markup.
//
// Supported:  # Heading   ## Sub   - bullet   1. step   **bold**   *italic*
//             ! Safety warning line   [link text](https://...)   blank line = new paragraph
//             [ ] Needs hay -> Put out hay   (follow-up: becomes a to-do if ticked)
//             ## [ ] Sharpers                (a heading with its own tick-box, e.g. a stop on a route)
// With { checklist: true }, bullets and numbered steps become tickable boxes.

// A follow-up line: "[ ] What to tick -> To-do to create". The to-do's title
// gets the nearest heading above it added, e.g. "Put out hay – Sharpers".
const FOLLOWUP_RE = /^\[\s?\]\s+(.+?)\s*(?:->|→)\s*(.+)$/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const BOX_RE = /^\[\s?\]\s+/;

// Shared with the server, which uses it to create the to-dos.
export function parseFollowups(text) {
  const out = [];
  let heading = '';
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const t = raw.trim();
    let m;
    if ((m = t.match(HEADING_RE))) heading = m[2].replace(BOX_RE, '').replace(/\*\*/g, '').trim();
    else if ((m = t.match(FOLLOWUP_RE))) {
      out.push({ index: out.length, label: m[1], action: m[2], where: heading, todo: heading ? `${m[2]} – ${heading}` : m[2] });
    }
  }
  return out;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function renderGuide(text, { checklist = false, idPrefix = 'step' } = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  let step = 0;
  let followup = 0;
  const closeList = () => { if (list) { out.push(list === 'fu' ? '</ul>' : `</${list}>`); list = null; } };

  for (const raw of lines) {
    const line = esc(raw.trimEnd());
    const t = line.trim();
    let m;
    if (!t) { closeList(); continue; }
    const fu = raw.trim().match(FOLLOWUP_RE);
    if (fu) {
      if (list !== 'fu') { closeList(); out.push('<ul class="checklist followups">'); list = 'fu'; }
      const i = followup++;
      const label = inline(esc(fu[1]));
      out.push(checklist
        ? `<li><label><input type="checkbox" data-followup="${i}"> <span>${label}</span></label></li>`
        : `<li>☐ ${label}</li>`);
      continue;
    }
    if ((m = t.match(HEADING_RE))) {
      closeList();
      const lvl = m[1].length + 2; // h3..h5 inside a page
      if (BOX_RE.test(m[2])) {
        // "## [ ] Sharpers": a stop you tick off as you go.
        const text = inline(m[2].replace(BOX_RE, ''));
        step++;
        out.push(checklist
          ? `<h${lvl} class="stop"><label><input type="checkbox" data-step="${step}" id="${idPrefix}-${step}"> <span>${text}</span></label></h${lvl}>`
          : `<h${lvl} class="stop">☐ ${text}</h${lvl}>`);
      } else {
        out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      }
    } else if ((m = t.match(/^(?:!|⚠️?)\s*(.*)$/))) {
      closeList();
      out.push(`<div class="warn"><b>⚠ Safety:</b> ${inline(m[1])}</div>`);
    } else if ((m = t.match(/^(?:[-*]|\d+[.)])\s+(?:\[[ xX]?\]\s*)?(.*)$/))) {
      const kind = /^\d/.test(t) ? 'ol' : 'ul';
      if (list !== kind) { closeList(); out.push(`<${kind} class="${checklist ? 'checklist' : ''}">`); list = kind; }
      step++;
      if (checklist) {
        const id = `${idPrefix}-${step}`;
        out.push(`<li><label><input type="checkbox" data-step="${step}" id="${id}"> <span>${inline(m[1])}</span></label></li>`);
      } else {
        out.push(`<li>${inline(m[1])}</li>`);
      }
    } else {
      closeList();
      out.push(`<p>${inline(t)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}
