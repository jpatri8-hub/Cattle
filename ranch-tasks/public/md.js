// Tiny, safe Markdown-ish renderer for guides. Everything is HTML-escaped
// first, so guide text can never inject markup.
//
// Supported:  # Heading   ## Sub   - bullet   1. step   **bold**   *italic*
//             ! Safety warning line   [link text](https://...)   blank line = new paragraph
// With { checklist: true }, bullets and numbered steps become tickable boxes.

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
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const raw of lines) {
    const line = esc(raw.trimEnd());
    const t = line.trim();
    let m;
    if (!t) { closeList(); continue; }
    if ((m = t.match(/^(#{1,3})\s+(.*)$/))) {
      closeList();
      const lvl = m[1].length + 2; // h3..h5 inside a page
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
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
