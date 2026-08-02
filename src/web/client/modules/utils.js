/* huu web UI — vanilla ES module utilities. */

export function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
export function cap(s) { return s[0].toUpperCase() + s.slice(1); }
export function humanize(s) { return String(s || '').replace(/_/g, ' '); }
export function fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
export function fmtCost(n) { return '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(4)); }
export function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(ss).padStart(2, '0');
}
let toastT = null;
export function toast(msg, isErr) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.classList.toggle('err', !!isErr); t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.hidden = true), 250); }, 2600);
}
export function shortDir(p) {
  if (!p) return '';
  const parts = String(p).replace(/\/+$/, '').split('/');
  return parts.length <= 3 ? p : '…/' + parts.slice(-2).join('/');
}
export function projectName(p) {
  if (!p) return '';
  const parts = String(p).replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || String(p);
}
