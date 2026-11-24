import { esc, fmt, toast } from './common.js';

export const MKEYS = ['phone', 'qr', 'account'];
export const MDEF = {
  phone: { title: 'التحويل برقم الهاتف', icon: '📱' },
  qr: { title: 'التحويل عبر QR Code', icon: '🔳' },
  account: { title: 'التحويل برقم الحساب / البطاقة', icon: '💳' }
};
export function activeMethods(cfg) {
  const m = (cfg && cfg.methods) || {};
  return MKEYS.filter(k => m[k] && m[k].enabled && (k === 'qr' ? m[k].imageUrl : m[k].number))
    .sort((a, b) => (m[a].order || 0) - (m[b].order || 0))
    .map(k => ({ key: k, ...MDEF[k], ...m[k], title: m[k].title || MDEF[k].title }));
}
export function methodCard(m, amount, pickLabel) {
  const body = m.key === 'qr'
    ? `<div class="qrw"><img class="qrimg" data-zoom src="${esc(m.imageUrl)}" alt="رمز QR للتحويل"><a class="btn ghost sm" href="${esc(m.imageUrl)}" download="mr-candy-qr">حفظ الصورة</a></div>`
    : `<div class="kv"><span>${m.key === 'phone' ? 'رقم الهاتف' : 'رقم الحساب / البطاقة'}</span><b dir="ltr">${esc(m.number)}</b><button type="button" class="ghost sm" data-cp="${esc(m.number)}">نسخ</button></div>`;
  return `<div class="mcard"><div class="mh"><span aria-hidden="true">${m.icon}</span><h3>${esc(m.title)}</h3></div>
  ${m.beneficiary ? `<div class="kv"><span>اسم المستفيد</span><b>${esc(m.beneficiary)}</b></div>` : ''}${body}
  ${amount != null ? `<div class="kv"><span>المبلغ المطلوب</span><b>${fmt(amount)}</b></div>` : ''}
  ${m.instructions ? `<p class="ins">${esc(m.instructions)}</p>` : ''}
  ${pickLabel ? `<button type="button" class="wide" data-pick="${m.key}">${pickLabel}</button>` : ''}</div>`;
}
export function videoHtml(v) {
  if (!v || !v.enabled || !/^https?:\/\//i.test(v.url || '')) return '';
  const u = v.url.trim(), yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  const inner = yt ? `<iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" title="${esc(v.title || 'فيديو شرح التحويل')}" allowfullscreen loading="lazy"></iframe>`
    : /\.(mp4|webm|mov)(\?|$)/i.test(u) ? `<video src="${esc(u)}" controls playsinline preload="metadata"></video>`
    : `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">فتح فيديو الشرح</a>`;
  return `<div class="vid">${v.title ? `<h3>${esc(v.title)}</h3>` : ''}<div class="vbox">${inner}</div>${v.desc ? `<p class="d">${esc(v.desc)}</p>` : ''}</div>`;
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-cp]');
  if (c) { navigator.clipboard.writeText(c.dataset.cp).then(() => toast('تم النسخ'), () => toast('تعذر النسخ')); return; }
  const z = e.target.closest('[data-zoom]'); if (z) z.classList.toggle('zoom');
});
