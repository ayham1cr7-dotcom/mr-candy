export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = n => Number(n || 0).toLocaleString('ar-IQ') + ' د.ع';
export const STATUS = { processing: 'قيد التجهيز', completed: 'تم الإتمام', canceled: 'ملغي' };
export const LS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
export const setLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const newCode = () => 'MC-' + [...crypto.getRandomValues(new Uint8Array(8))].map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
export function toast(m) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = m;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
export function openDlg(html) {
  const d = $('#dlg'); d.innerHTML = html;
  if (!d.open) d.showModal();
  return d;
}
export const closeDlg = () => { const d = $('#dlg'); if (d.open) d.close(); };
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDlg(); });
export const dateOf = o => (o.createdAt && o.createdAt.toDate) ? o.createdAt.toDate() : new Date();
export const when = o => dateOf(o).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' });

export const PAYST = { cod: 'دفع عند الاستلام', unselected: 'لم يتم اختيار طريقة الدفع', awaiting_transfer: 'بانتظار التحويل', awaiting_review: 'بانتظار مراجعة التحويل', confirmed: 'تم تأكيد الدفع', rejected: 'تم رفض التحويل', awaiting_new_proof: 'بانتظار إثبات جديد', canceled: 'تم إلغاء الطلب', refunded: 'تم استرداد المبلغ' };

export function api(action, body = {}, token, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('POST', '/.netlify/functions/api');
    x.setRequestHeader('Content-Type', 'application/json');
    if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
    if (onProgress) x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status < 300 ? res(j) : rej(new Error(j.error || 'حدث خطأ في الاتصال')); };
    x.onerror = () => rej(new Error('تعذر الاتصال بالإنترنت'));
    x.send(JSON.stringify({ action, ...body }));
  });
}
// تصغير الصورة وخفض الجودة تدريجياً حتى يصل الحجم للحد المطلوب
export async function shrink(file, maxSide = 1400, maxBytes = 450000) {
  const b = await createImageBitmap(file), k = Math.min(1, maxSide / Math.max(b.width, b.height));
  const c = document.createElement('canvas'); c.width = Math.round(b.width * k); c.height = Math.round(b.height * k);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(b, 0, 0, c.width, c.height);
  let q = .85, blob;
  do { blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); q -= .1; } while (blob.size > maxBytes && q > .3);
  if (blob.size > maxBytes) throw new Error('الصورة كبيرة جداً، اختر صورة أصغر');
  return blob;
}
export const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('تعذر قراءة الصورة')); r.readAsDataURL(blob); });

// مناطق وأجور التوصيل (المفاتيح تُحفظ في settings/site ويمكن تعديلها من لوحة الإدارة)
export const DELIVERY = {
  in: { label: 'داخل تكريت: توصيل Door to Door', short: 'داخل تكريت - Door to Door', key: 'feeTikrit', def: 2000 },
  qadisiya: { label: 'منطقة القادسية داخل تكريت: توصيل Door to Door', short: 'القادسية - Door to Door', key: 'feeQad', def: 3000 },
  out: { label: 'خارج تكريت: شركة الوسيط', short: 'شركة الوسيط (خارج تكريت)', key: 'feeOut', def: 5000 }
};
export const feeFor = (d, S) => { const x = DELIVERY[d] || DELIVERY.in, v = S && S[x.key]; return Number(v == null ? x.def : v); };
