import { db, fs } from './firebase.js';
import { $, $$, esc, fmt, STATUS, PAYST, LS, setLS, newCode, toast, openDlg, closeDlg, when, api, shrink, toB64 } from './common.js';
import { activeMethods, methodCard, videoHtml } from './pay.js';

let S = { feeIn: 3000, feeOut: 5000 }, cats = [], prods = [], offers = [], brands = [], offerP = [], cart = LS('mc_cart', {});
const F = { q: '', cat: '', avail: 'all', sort: 'new' };

const isOut = p => p.active === false || !(p.stock > 0);
const catName = id => (cats.find(c => c.id === id) || {}).name || '';
const logoSrc = () => S.logoUrl || 'assets/logo.png';

/* ---------- بيانات حية من Firestore ---------- */
fs.onSnapshot(fs.doc(db, 'settings', 'site'), s => {
  S = Object.assign({ feeIn: 3000, feeOut: 5000 }, s.data() || {});
  if (S.title) $('#heroTitle').textContent = S.title;
  if (S.sub) $('#heroSub').textContent = S.sub;
  if (S.about) $('#aboutText').textContent = S.about;
  $$('.logo').forEach(i => i.src = logoSrc());
  renderCart(); renderProducts();
});
fs.onSnapshot(fs.query(fs.collection(db, 'categories'), fs.orderBy('order')), s => {
  cats = s.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCats(); renderProducts();
});
fs.onSnapshot(fs.query(fs.collection(db, 'products'), fs.orderBy('createdAt', 'desc')), s => {
  prods = s.docs.map(d => ({ id: d.id, ...d.data() }));
  rebuild();
}, () => { $('#grid').innerHTML = '<p class="empty">تعذر تحميل المنتجات. تحقق من الاتصال وإعدادات Firebase.</p>'; });

/* ---------- العروض والبوكسات ---------- */
fs.onSnapshot(fs.query(fs.collection(db, 'offers'), fs.orderBy('createdAt', 'desc')), s => { offers = s.docs.map(d => ({ id: d.id, ...d.data() })); rebuild(); }, () => {});
fs.onSnapshot(fs.collection(db, 'brands'), s => { brands = s.docs.map(d => ({ id: d.id, ...d.data() })); renderOffers(); }, () => {});
const endMs = o => (o.endsAt && o.endsAt.toMillis) ? o.endsAt.toMillis() : 0;
const expired = o => endMs(o) > 0 && endMs(o) <= Date.now();
const find = id => prods.find(x => x.id === id) || offerP.find(x => x.id === id);
function offerStock(o) {
  if (o.active === false || expired(o)) return 0;
  return Math.min(999, ...(o.items || []).map(c => { const p = prods.find(x => x.id === c.id); return p && p.active !== false ? Math.floor(p.stock / c.qty) : 0; }));
}
function rebuild() {
  offerP = offers.filter(o => o.active !== false).map(o => ({ id: 'o_' + o.id, offer: true, o, name: o.title, price: o.price, stock: offerStock(o), active: true, imageUrl: o.imageUrl, comps: (o.items || []).map(c => ({ id: c.id, name: c.name, qty: c.qty })) }));
  clampCart(); renderOffers(); renderProducts(); renderCart();
}
const left = ms => { const t = Math.floor(ms / 1000), d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60), s = t % 60, z = n => String(n).padStart(2, '0'); return (d ? d + ' يوم ' : '') + z(h) + ':' + z(m) + ':' + z(s); };
function cornerHtml(o) {
  const bs = (o.brandIds || []).map(id => brands.find(b => b.id === id)).filter(Boolean).slice(0, 3);
  return bs.length ? `<div class="corner">${bs.map(b => `<img src="${esc(b.logoUrl)}" alt="${esc(b.name)}">`).join('')}</div>` : '';
}
function offerCard(p) {
  const o = p.o, out = isOut(p), q = cart[p.id] || 0, end = endMs(o);
  const orig = (o.items || []).reduce((a, c) => { const pr = prods.find(x => x.id === c.id); return a + (pr ? pr.price * c.qty : 0); }, 0), save = orig > o.price ? orig - o.price : 0;
  const img = p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(o.title)}" loading="lazy">` : '<div class="gift" aria-hidden="true">🎁</div>';
  return `<article class="card offer ${out ? 'out' : ''}">${cornerHtml(o)}<div class="imgbox">${img}${out ? `<span class="tag bad">${expired(o) ? 'انتهى العرض' : 'نفدت الكمية'}</span>` : ''}${save && !out ? `<span class="tag save">وفّر ${fmt(save)}</span>` : ''}<span class="price">${fmt(o.price)}</span></div>
  <div class="cb"><small>${o.type === 'box' ? 'بوكس' : 'عرض'}</small><h3>${esc(o.title)}</h3>${o.desc ? `<p class="d">${esc(o.desc)}</p>` : ''}
  <ul class="inc">${(o.items || []).map(c => `<li>${esc(c.name)} × ${c.qty}</li>`).join('')}</ul>
  ${end && !out ? `<div class="timer" data-end="${end}">ينتهي العرض بعد ${left(end - Date.now())}</div>` : ''}
  ${out ? '<button disabled>غير متاح</button>' : `<div class="qty"><button data-dec="${p.id}" aria-label="إنقاص">−</button><b>${q}</b><button data-inc="${p.id}" aria-label="زيادة">+</button></div>`}</div></article>`;
}
function renderOffers() {
  $('#offers').hidden = !offerP.length;
  $('#offerGrid').innerHTML = offerP.map(offerCard).join('');
}
setInterval(() => {
  let ch = false;
  $$('[data-end]').forEach(el => { const l = el.dataset.end - Date.now(); if (l <= 0) ch = true; else el.textContent = 'ينتهي العرض بعد ' + left(l); });
  if (ch) rebuild();
}, 1000);

/* ---------- الأقسام والمنتجات ---------- */
function renderCats() {
  const chip = c => `<button class="cat ${F.cat === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`;
  const all = `<button class="cat ${F.cat === '' ? 'on' : ''}" data-cat="">الكل</button>`;
  $('#cats').innerHTML = all + cats.map(chip).join('');
  $('#fcats').innerHTML = cats.map(c => `<button class="cat" data-cat="${c.id}">${esc(c.name)}</button>`).join('');
}
function card(p) {
  const o = isOut(p), q = cart[p.id] || 0, avg = p.ratingCount ? p.ratingSum / p.ratingCount : 0;
  const img = p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" loading="lazy">` : `<div class="ph"><img src="${logoSrc()}" alt=""></div>`;
  const tag = o ? '<span class="tag bad">نفدت الكمية</span>' : (p.stock <= 3 ? `<span class="tag warn">متبقي ${p.stock} فقط</span>` : '');
  return `<article class="card ${o ? 'out' : ''}"><div class="imgbox">${img}${tag}<span class="price">${fmt(p.price)}</span></div>
  <div class="cb"><small>${esc(catName(p.categoryId))}</small><h3>${esc(p.name)}</h3>${p.desc ? `<p class="d">${esc(p.desc)}</p>` : ''}
  <button class="rate" data-rev="${p.id}">★ ${avg ? avg.toFixed(1) : '–'} <span>(${p.ratingCount || 0}) اضغط للتقييم</span></button>
  ${o ? '<button disabled>خلص</button>' : `<div class="qty"><button data-dec="${p.id}" aria-label="إنقاص">−</button><b>${q}</b><button data-inc="${p.id}" aria-label="زيادة">+</button></div>`}</div></article>`;
}
function renderProducts() {
  let l = prods.slice();
  if (F.cat) l = l.filter(p => p.categoryId === F.cat);
  if (F.q) l = l.filter(p => (p.name + ' ' + (p.desc || '')).toLowerCase().includes(F.q.toLowerCase()));
  if (F.avail === 'in') l = l.filter(p => !isOut(p));
  const avg = p => p.ratingCount ? p.ratingSum / p.ratingCount : 0;
  if (F.sort === 'rating') l.sort((a, b) => avg(b) - avg(a));
  if (F.sort === 'low') l.sort((a, b) => a.price - b.price);
  $('#grid').innerHTML = l.map(card).join('') || '<p class="empty">ما كو منتجات مطابقة حالياً.</p>';
}

/* ---------- السلة ---------- */
function clampCart() {
  Object.keys(cart).forEach(id => {
    const p = find(id);
    if (!p || isOut(p)) delete cart[id]; else if (cart[id] > p.stock) cart[id] = p.stock;
  });
  setLS('mc_cart', cart);
}
const items = () => Object.keys(cart).map(id => ({ p: find(id), q: cart[id] })).filter(x => x.p && x.q > 0);
const subtotal = () => items().reduce((a, x) => a + x.p.price * x.q, 0);
const feeNow = () => $('#delivery').value === 'in' ? Number(S.feeIn) : Number(S.feeOut);
function renderCart() {
  const it = items(), n = it.reduce((a, x) => a + x.q, 0);
  $('#cartCount').textContent = n;
  $('#cartItems').innerHTML = it.length ? it.map(x => `<div class="ci"><b>${esc(x.p.name)}</b><span>${fmt(x.p.price * x.q)}</span>
    <div class="qty"><button data-dec="${x.p.id}" aria-label="إنقاص">−</button><b>${x.q}</b><button data-inc="${x.p.id}" aria-label="زيادة">+</button><button class="ghost" data-rm="${x.p.id}">حذف</button></div></div>`).join('')
    : '<p class="empty">السلة فارغة. اختر حلويات من القائمة.</p>';
  $('#orderForm').hidden = !it.length;
  const s = subtotal(), f = feeNow();
  $('#totals').innerHTML = `<div class="l"><span>المجموع الفرعي</span><span>${fmt(s)}</span></div><div class="l"><span>أجور التوصيل</span><span>${fmt(f)}</span></div><div class="l t"><span>الإجمالي</span><span>${fmt(s + f)}</span></div>`;
}
function change(id, d) {
  const p = find(id); if (!p) return;
  const n = (cart[id] || 0) + d;
  if (n > p.stock) { toast(`المتوفر ${p.stock} فقط`); return; }
  if (n <= 0) delete cart[id]; else cart[id] = n;
  setLS('mc_cart', cart); renderProducts(); renderOffers(); renderCart();
  if (d > 0) { const b = $('#cartBtn'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
}
function cartOpen(on) {
  $('#cart').classList.toggle('open', on); $('#cart').setAttribute('aria-hidden', !on); $('#scrim').hidden = !on;
  if (on) $('#closeCart').focus();
}

/* ---------- إرسال الطلب ---------- */
$('#orderForm').addEventListener('submit', async e => {
  e.preventDefault();
  const it = items(); if (!it.length) return;
  for (const x of it) if (isOut(x.p) || x.q > x.p.stock) { toast(`الكمية غير متوفرة: ${x.p.name}`); return; }
  const fd = new FormData(e.target), code = newCode(), s = subtotal(), fee = feeNow();
  const order = {
    code, name: fd.get('name').trim(), phone: fd.get('phone').trim(), addr: fd.get('addr').trim(), note: (fd.get('note') || '').trim(),
    delivery: fd.get('delivery'), pay: fd.get('pay'), payment: { status: fd.get('pay') === 'transfer' ? 'awaiting_transfer' : 'cod' },
    items: it.map(x => ({ id: x.p.id, name: x.p.name, price: x.p.price, qty: x.q, ...(x.p.comps ? { comps: x.p.comps } : {}) })),
    subtotal: s, fee, total: s + fee, status: 'processing', pinned: false, inventoryDeducted: false, createdAt: fs.serverTimestamp()
  };
  const btn = $('#sendOrder'); btn.disabled = true; btn.textContent = 'جاري الإرسال...';
  try {
    await fs.setDoc(fs.doc(db, 'orders', code), order);
    setLS('mc_orders', [code, ...LS('mc_orders', [])].slice(0, 20));
    cart = {}; setLS('mc_cart', cart); e.target.reset(); renderProducts(); renderCart(); cartOpen(false);
    const c = { code, phone4: d4(order.phone) }; setLS('mc_last', { code, p: c.phone4 });
    if (order.pay === 'transfer') payFlow(order, c); else showOrder(order);
  } catch (err) { toast('تعذر إرسال الطلب، حاول مرة أخرى'); console.error(err); }
  btn.disabled = false; btn.textContent = 'إرسال الطلب';
});
const orderHtml = o => `<p>رقم الطلب: <b dir="ltr">${esc(o.code)}</b></p><p>الحالة: <span class="st s-${o.status}">${STATUS[o.status] || o.status}</span></p>
  ${o.payment ? `<p>حالة الدفع: <span class="st">${PAYST[o.payment.status] || ''}</span>${o.payment.rejectReason ? `<br><b>ملاحظة المتجر:</b> ${esc(o.payment.rejectReason)}` : ''}</p>` : ''}
  ${o.items.map(i => `<div class="line"><span>${esc(i.name)} × ${i.qty}${i.comps ? `<br><small>${i.comps.map(c => esc(c.name) + ' × ' + c.qty).join('، ')}</small>` : ''}</span><span>${fmt(i.price * i.qty)}</span></div>`).join('')}
  <div class="line"><span>التوصيل (${o.delivery === 'in' ? 'دور تو دور' : 'الوسيط'})</span><span>${fmt(o.fee)}</span></div>
  <div class="line"><b>الإجمالي</b><b>${fmt(o.total)}</b></div>
  <p>الدفع: ${o.pay === 'cash' ? 'عند الاستلام' : 'تحويل إلكتروني'}<br>الهاتف: ${esc(o.phone)}<br>العنوان: ${esc(o.addr)}${o.note ? `<br>ملاحظتك: ${esc(o.note)}` : ''}</p>`;
function showOrder(o) {
  openDlg(`<h2>تم استلام طلبك</h2>${orderHtml(o)}<p class="d">احتفظ برقم الطلب لتتبعه من زر "تتبع طلبك".</p><button data-close>تمام</button>`);
}

/* ---------- الدفع بالتحويل اليدوي ---------- */
const d4 = ph => String(ph || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '').slice(-4);
let PAY = {}, ctx = null, payS = { o: null, method: null, file: null }, lastTracked = null, trackTimer = null;
fs.onSnapshot(fs.doc(db, 'settings', 'payment'), s => {
  PAY = s.data() || {};
  const n = activeMethods(PAY).length, opt = $('#payTransfer'), sel = $('#orderForm [name=pay]');
  opt.disabled = !n; opt.textContent = n ? 'تحويل إلكتروني (هاتف / QR / حساب)' : 'التحويل الإلكتروني غير متوفر حالياً';
  if (!n && sel.value === 'transfer') sel.value = 'cash';
  if (payS.o && $('#dlg').open && $('#dlg').dataset.pay && !payS.file) payDlg();
}, () => {});
function payFlow(o, c) {
  payS = { o, method: null, file: null }; ctx = c; payDlg();
  $('#dlg').addEventListener('close', () => { delete $('#dlg').dataset.pay; }, { once: true });
}
function payDlg() {
  const o = payS.o, ms = activeMethods(PAY), m = ms.find(x => x.key === payS.method);
  const head = `<h2>${m ? 'أرسل إثبات التحويل' : 'اختر طريقة التحويل'}</h2><p>رقم الطلب: <b dir="ltr">${esc(o.code)}</b> <button type="button" class="ghost sm" data-cp="${esc(o.code)}">نسخ</button><br>المبلغ المطلوب: <b>${fmt(o.total)}</b></p>`;
  let body;
  if (!ms.length) body = '<p class="empty">طرق التحويل غير متوفرة حالياً. طلبك محفوظ برقمه، وتواصل مع المتجر على 07715151100.</p><button type="button" data-close>إغلاق</button>';
  else if (!m) body = videoHtml(PAY.video) + ms.map(x => methodCard(x, o.total, 'اختيار هذه الطريقة')).join('') + '<p><button type="button" class="ghost" data-close>لاحقاً (من تتبع الطلب)</button></p>';
  else body = methodCard(m, o.total) + `<div class="up"><b>إثبات التحويل (JPG أو PNG أو WEBP، حتى 5MB)</b><input type="file" id="pf" accept="image/jpeg,image/png,image/webp"><div id="pv"></div><div id="pg" class="prog" hidden><i></i></div>
  <p class="hint">رفع الصورة لا يعني تأكيد الدفع. يبقى الطلب بانتظار مراجعة المتجر.</p><div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="psend" disabled>إرسال الإثبات</button><button type="button" class="ghost" id="pback">تغيير الطريقة</button><button type="button" class="ghost" data-close>لاحقاً</button></div></div>`;
  openDlg(head + body); $('#dlg').dataset.pay = '1';
}
function pickFile(f) {
  const ok = ['image/jpeg', 'image/png', 'image/webp'];
  if (!f) return;
  if (!ok.includes(f.type)) { toast('النوع غير مدعوم. استخدم JPG أو PNG أو WEBP'); $('#pf').value = ''; return; }
  if (f.size > 5 * 1024 * 1024) { toast('الصورة أكبر من 5MB'); $('#pf').value = ''; return; }
  payS.file = f;
  $('#pv').innerHTML = `<img class="pvimg" src="${URL.createObjectURL(f)}" alt="معاينة الإثبات"><button type="button" class="ghost sm" id="prm">حذف الصورة</button>`;
  $('#psend').disabled = false;
}
async function sendProof() {
  const b = $('#psend'); b.disabled = true; b.textContent = 'جاري الرفع...'; $('#pg').hidden = false;
  try {
    const image = await toB64(await shrink(payS.file, 1400, 450000));
    await api('submit', { code: payS.o.code, phone4: ctx.phone4, method: payS.method, image, mime: 'image/jpeg' }, null, f => { $('#pg i').style.width = Math.round(f * 100) + '%'; });
    const o = payS.o, ml = { phone: 'رقم الهاتف', qr: 'QR Code', account: 'رقم الحساب / البطاقة' }[payS.method]; payS.file = null;
    openDlg(`<h2>تم إرسال الإثبات</h2><p>رقم الطلب: <b dir="ltr">${esc(o.code)}</b> <button type="button" class="ghost sm" data-cp="${esc(o.code)}">نسخ</button></p>
    <div class="line"><span>الاسم</span><span>${esc(o.name)}</span></div><div class="line"><span>الإجمالي</span><span>${fmt(o.total)}</span></div><div class="line"><span>طريقة التحويل</span><span>${ml}</span></div>
    <div class="line"><span>حالة الدفع</span><span class="st">${PAYST.awaiting_review}</span></div><div class="line"><span>حالة الطلب</span><span class="st">${STATUS.processing}</span></div>
    <p class="hint">تحويلك بانتظار مراجعة الإدارة. لا يُعتمد الدفع إلا بعد التأكد من وصول المبلغ. تابع الحالة من زر "تتبع طلبك".</p><button data-close>تمام</button>`);
  } catch (e) { toast(e.message || 'تعذر الإرسال'); b.disabled = false; b.textContent = 'إعادة المحاولة'; $('#pg').hidden = true; }
}

/* ---------- تتبع الطلب (تحقق: رقم الطلب + آخر 4 أرقام من الهاتف) ---------- */
const retry = o => (o.pay === 'transfer' && ['awaiting_transfer', 'rejected', 'awaiting_new_proof'].includes(o.payment.status)) ? '<p><button type="button" data-payfor>إرفاق إثبات التحويل</button></p>' : '';
function trackDlg() {
  const last = LS('mc_last', {});
  openDlg(`<h2>تتبع طلبك</h2><form id="tf"><label>رقم الطلب<input name="c" dir="ltr" value="${esc(last.code || '')}" placeholder="MC-XXXXXXXX" required></label><label>آخر 4 أرقام من هاتفك<input name="p" inputmode="numeric" maxlength="4" value="${esc(last.p || '')}" required></label><p><button>عرض الحالة</button> <button type="button" class="ghost" data-close>إغلاق</button></p></form><div id="tr"></div>`);
  const run = async quiet => {
    const f = new FormData($('#tf')), code = f.get('c').trim().toUpperCase(), p = d4(f.get('p'));
    try { const { order } = await api('track', { code, phone4: p }); lastTracked = order; ctx = { code, phone4: p }; setLS('mc_last', { code, p }); $('#tr').innerHTML = orderHtml(order) + retry(order); }
    catch (e) { if (!quiet) $('#tr').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  };
  $('#tf').onsubmit = ev => { ev.preventDefault(); clearInterval(trackTimer); run(); trackTimer = setInterval(() => run(true), 15000); };
  $('#dlg').addEventListener('close', () => clearInterval(trackTimer), { once: true });
  if (last.code && last.p) $('#tf').requestSubmit();
}

/* ---------- التقييمات ---------- */
let unsubRev = null;
function reviewDlg(id) {
  const p = prods.find(x => x.id === id); if (!p) return;
  openDlg(`<h2>${esc(p.name)}</h2><div id="rl">جاري التحميل...</div><h3>أضف تقييمك</h3>
  <form id="rf"><div class="stars" role="radiogroup" aria-label="التقييم">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-s="${i}" aria-label="${i} نجوم">★</button>`).join('')}</div>
  <label>تعليق (اختياري)<textarea name="c" rows="2" maxlength="300"></textarea></label><p><button>إرسال التقييم</button> <button type="button" class="ghost" data-close>إغلاق</button></p></form>`);
  let stars = 0;
  $$('.stars button').forEach(b => b.onclick = () => { stars = +b.dataset.s; $$('.stars button').forEach(x => x.classList.toggle('on', +x.dataset.s <= stars)); });
  if (unsubRev) unsubRev();
  unsubRev = fs.onSnapshot(fs.query(fs.collection(db, 'products', id, 'reviews'), fs.orderBy('createdAt', 'desc'), fs.limit(20)), s => {
    $('#rl').innerHTML = s.docs.length ? s.docs.map(d => { const r = d.data(); return `<div class="rev"><b style="color:#e0a800">${'★'.repeat(r.stars)}</b> ${esc(r.comment)}</div>`; }).join('') : '<p class="empty">لا توجد تقييمات بعد.</p>';
  });
  $('#dlg').addEventListener('close', () => { if (unsubRev) unsubRev(); }, { once: true });
  $('#rf').onsubmit = async ev => {
    ev.preventDefault();
    if (!stars) { toast('اختر عدد النجوم'); return; }
    const done = LS('mc_rated', []); if (done.includes(id)) { toast('قيّمت هذا المنتج سابقاً'); return; }
    try {
      const b = fs.writeBatch(db);
      b.set(fs.doc(fs.collection(db, 'products', id, 'reviews')), { stars, comment: new FormData(ev.target).get('c').trim(), createdAt: fs.serverTimestamp() });
      b.update(fs.doc(db, 'products', id), { ratingSum: fs.increment(stars), ratingCount: fs.increment(1) });
      await b.commit(); setLS('mc_rated', [...done, id]); toast('شكراً لتقييمك'); closeDlg();
    } catch (err) { toast('تعذر إرسال التقييم'); console.error(err); }
  };
}

/* ---------- الأحداث ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button,a'); if (!t) return;
  const d = t.dataset;
  if (d.pick) { payS.method = d.pick; payS.file = null; payDlg(); }
  else if (t.id === 'pback') { payS.method = null; payS.file = null; payDlg(); }
  else if (t.id === 'psend') sendProof();
  else if (t.id === 'prm') { payS.file = null; $('#pf').value = ''; $('#pv').innerHTML = ''; $('#psend').disabled = true; }
  else if (d.payfor !== undefined) { clearInterval(trackTimer); payFlow(lastTracked, ctx); }
  else if (d.inc) change(d.inc, 1);
  else if (d.dec) change(d.dec, -1);
  else if (d.rm) { delete cart[d.rm]; setLS('mc_cart', cart); renderProducts(); renderOffers(); renderCart(); }
  else if (d.rev) reviewDlg(d.rev);
  else if (d.cat !== undefined) { F.cat = d.cat; renderCats(); renderProducts(); document.getElementById('products').scrollIntoView(); }
  else if (t.id === 'cartBtn') cartOpen(true);
  else if (t.id === 'closeCart') cartOpen(false);
  else if (t.id === 'trackBtn' || t.id === 'trackLink') { e.preventDefault(); $('#nav').classList.remove('open'); trackDlg(); }
  else if (t.id === 'burger') { const o = $('#nav').classList.toggle('open'); t.setAttribute('aria-expanded', o); }
  else if (d.sort) { F.sort = d.sort; $('#sort').value = d.sort; renderProducts(); $('#nav').classList.remove('open'); }
  else if (t.closest('#nav')) $('#nav').classList.remove('open');
});
$('#scrim').addEventListener('click', () => cartOpen(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') cartOpen(false); });
$('#q').addEventListener('input', e => { F.q = e.target.value; renderProducts(); });
$('#avail').addEventListener('change', e => { F.avail = e.target.value; renderProducts(); });
$('#sort').addEventListener('change', e => { F.sort = e.target.value; renderProducts(); });
$('#delivery').addEventListener('change', renderCart);

const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: .08 });
$$('.rv').forEach(el => io.observe(el));
renderCats(); renderCart();

document.addEventListener('change', e => { if (e.target.id === 'pf') pickFile(e.target.files[0]); });
