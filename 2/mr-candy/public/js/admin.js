import { db, auth, fs, au } from './firebase.js';
import { $, $$, esc, fmt, STATUS, PAYST, toast, openDlg, closeDlg, when, dateOf, api } from './common.js';
import { MKEYS, MDEF, activeMethods, methodCard, videoHtml } from './pay.js';

let tab = 'orders', sub = 'processing';
let orders = [], prods = [], cats = [], offers = [], brands = [], site = {}, pay = {}, rv = 'awaiting_review';
const tok = () => auth.currentUser.getIdToken();
let unsubs = [];
const AUTH_ERR = { 'auth/invalid-credential': 'البريد أو كلمة المرور غير صحيحة', 'auth/invalid-email': 'البريد الإلكتروني غير صالح', 'auth/too-many-requests': 'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة', 'auth/network-request-failed': 'تعذر الاتصال بالإنترنت' };

/* ---------- تسجيل الدخول (Firebase Auth فقط) ---------- */
$('#lf').addEventListener('submit', async e => {
  e.preventDefault(); $('#lerr').textContent = '';
  const f = new FormData(e.target);
  try { await au.signInWithEmailAndPassword(auth, f.get('e').trim(), f.get('p')); }
  catch (err) { $('#lerr').textContent = AUTH_ERR[err.code] || 'تعذر تسجيل الدخول'; }
});
$('#out').addEventListener('click', () => au.signOut(auth));

au.onAuthStateChanged(auth, async user => {
  unsubs.forEach(u => u()); unsubs = [];
  if (!user) { $('#login').hidden = false; $('#app').hidden = true; return; }
  try {
    const a = await fs.getDoc(fs.doc(db, 'admins', user.uid));
    if (!a.exists()) { await au.signOut(auth); $('#lerr').textContent = 'هذا الحساب ليس لديه صلاحية الإدارة'; return; }
  } catch { await au.signOut(auth); $('#lerr').textContent = 'تعذر التحقق من الصلاحية. تحقق من قواعد Firestore'; return; }
  $('#login').hidden = true; $('#app').hidden = false; $('#who').textContent = user.email;
  listen();
});

function listen() {
  const L = (q, fn) => unsubs.push(fs.onSnapshot(q, fn, e => { console.error(e); toast('خطأ في قراءة البيانات: ' + e.code); }));
  L(fs.query(fs.collection(db, 'orders'), fs.orderBy('createdAt', 'desc')), s => { orders = s.docs.map(d => ({ id: d.id, ...d.data() })); summary(); if (tab === 'orders' || tab === 'review') render(); });
  L(fs.collection(db, 'products'), s => { prods = s.docs.map(d => ({ id: d.id, ...d.data() })); summary(); if (tab === 'products') render(); });
  L(fs.query(fs.collection(db, 'categories'), fs.orderBy('order')), s => { cats = s.docs.map(d => ({ id: d.id, ...d.data() })); if (tab === 'cats') render(); });
  L(fs.query(fs.collection(db, 'offers'), fs.orderBy('createdAt', 'desc')), s => { offers = s.docs.map(d => ({ id: d.id, ...d.data() })); if (tab === 'offers') render(); });
  L(fs.collection(db, 'brands'), s => { brands = s.docs.map(d => ({ id: d.id, ...d.data() })); if (tab === 'brands') render(); });
  L(fs.doc(db, 'settings', 'payment'), s => { pay = s.data() || {}; if (tab === 'review') render(); });
  L(fs.doc(db, 'settings', 'site'), s => { site = s.data() || {}; });
}

function summary() {
  const n = s => orders.filter(o => o.status === s).length;
  const low = prods.filter(p => p.active !== false && p.stock > 0 && p.stock <= 3).length;
  const out = prods.filter(p => p.active === false || !(p.stock > 0)).length;
  const t = [['قيد التجهيز', n('processing')], ['مكتملة', n('completed')], ['ملغاة', n('canceled')], ['مثبّتة', orders.filter(o => o.pinned).length], ['أوشكت على النفاد', low], ['نفدت', out]];
  $('#sum').innerHTML = t.map(x => `<div><b>${x[1]}</b>${x[0]}</div>`).join('');
}

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  tab = b.dataset.tab; $$('#tabs button').forEach(x => x.classList.toggle('on', x === b)); render();
});

function render() { ({ orders: rOrders, review: rReview, payset: rPaySet, products: rProducts, offers: rOffers, brands: rBrands, cats: rCats, settings: rSettings })[tab](); }

/* ---------- الطلبات ---------- */
const SUBS = { processing: 'قيد التجهيز', completed: 'المكتملة', pinned: 'المثبّتة', canceled: 'الأرشيف / الملغاة', all: 'السجل الكامل' };
const inSub = o => sub === 'all' || (sub === 'pinned' ? o.pinned : o.status === sub);
function orderCard(o) {
  return `<article class="oc ${o.pinned ? 'pin' : ''}"><header><b dir="ltr">${o.pinned ? '📌 ' : ''}${esc(o.code || o.id)}</b><span class="st s-${o.status}">${STATUS[o.status] || o.status}</span>${o.pay === 'transfer' ? `<span class="st">${PAYST[(o.payment || {}).status] || ''}</span>` : ''}<small>${when(o)}</small></header>
  <div class="og"><div><b>${esc(o.name)}</b><br><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a><br>${esc(o.addr)}</div>
  <div>${(o.items || []).map(i => `${esc(i.name)} × ${i.qty}${i.comps ? `<br><small>${i.comps.map(c => esc(c.name) + ' × ' + c.qty).join('، ')}</small>` : ''}`).join('<br>')}<br><small>${o.delivery === 'in' ? 'دور تو دور (داخل تكريت)' : 'الوسيط (خارج تكريت)'} · ${o.pay === 'cash' ? 'نقدي عند الاستلام' : 'تحويل إلكتروني'}</small></div>
  <div><b>${fmt(o.total)}</b><br><small>منها توصيل ${fmt(o.fee)}</small>${o.inventoryDeducted ? '<br><small>تم خصم المخزون</small>' : ''}</div></div>
  ${o.note ? `<p class="note">ملاحظة الزبون: ${esc(o.note)}</p>` : ''}
  <footer><select data-st="${o.id}" aria-label="الحالة">${Object.keys(STATUS).map(k => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${STATUS[k]}</option>`).join('')}</select>
  <button class="ghost" data-copy="${o.id}">نسخ الملخص</button><button class="ghost" data-edit="${o.id}">تعديل</button>
  <button class="ghost" data-pin="${o.id}">${o.pinned ? 'إلغاء التثبيت' : 'تثبيت'}</button><button class="danger" data-delo="${o.id}">حذف</button></footer></article>`;
}
function rOrders() {
  const l = orders.filter(inSub).sort((a, b) => (b.pinned - a.pinned) || (dateOf(b) - dateOf(a)));
  $('#view').innerHTML = `<div class="panel"><b>تصدير صورة الطلبات</b><div class="g3"><label>الفترة<select id="rg"><option value="month">هذا الشهر</option><option value="week">هذا الأسبوع</option><option value="custom">فترة مخصصة</option></select></label><label>من<input type="date" id="d1"></label><label>إلى<input type="date" id="d2"></label></div><p><button id="exp">تنزيل صورة PNG</button></p></div>
  <div class="subtabs">${Object.keys(SUBS).map(k => `<button data-sub="${k}" class="${sub === k ? 'on' : ''}">${SUBS[k]}</button>`).join('')}</div>
  ${l.map(orderCard).join('') || '<p class="hint">لا توجد طلبات في هذا القسم.</p>'}`;
}
const ord = id => orders.find(o => o.id === id);

async function setStatus(id, status) {
  const ref = fs.doc(db, 'orders', id), cur = ord(id);
  if (status === 'completed' && cur && cur.pay === 'transfer' && (cur.payment || {}).status !== 'confirmed') throw new Error('أكّد التحويل أولاً من تبويب مراجعة التحويلات');
  if (status !== 'completed') { await fs.updateDoc(ref, { status }); return; }
  // خصم المخزون مرة واحدة فقط وبشكل آمن عبر Transaction
  await fs.runTransaction(db, async tx => {
    const os = await tx.get(ref), o = os.data();
    if (o.inventoryDeducted) { tx.update(ref, { status }); return; }
    // يفكّ البوكسات والعروض إلى منتجاتها ويجمع الكميات
    const need = {};
    o.items.forEach(i => (i.comps ? i.comps.map(c => ({ id: c.id, name: c.name, qty: c.qty * i.qty })) : [{ id: i.id, name: i.name, qty: i.qty }])
      .forEach(c => { need[c.id] = { name: c.name, qty: ((need[c.id] || {}).qty || 0) + c.qty }; }));
    const ids = Object.keys(need), refs = ids.map(id => fs.doc(db, 'products', id));
    const snaps = await Promise.all(refs.map(r => tx.get(r)));
    snaps.forEach((p, k) => { if (!p.exists() || p.data().stock < need[ids[k]].qty) throw new Error('المخزون لا يكفي: ' + need[ids[k]].name); });
    snaps.forEach((p, k) => tx.update(refs[k], { stock: p.data().stock - need[ids[k]].qty }));
    tx.update(ref, { status, inventoryDeducted: true, completedAt: fs.serverTimestamp() });
  });
}
function summaryText(o) {
  return [`طلب ${o.code || o.id}`, `الاسم: ${o.name}`, `الهاتف: ${o.phone}`, `العنوان: ${o.addr}`, `التوصيل: ${o.delivery === 'in' ? 'دور تو دور' : 'الوسيط'}`, `الدفع: ${o.pay === 'cash' ? 'نقدي' : 'تحويل'}`,
    ...(o.note ? [`ملاحظة: ${o.note}`] : []), 'المنتجات:', ...o.items.map(i => `- ${i.name} × ${i.qty}`), `الإجمالي: ${fmt(o.total)}`].join('\n');
}
function editOrder(o) {
  openDlg(`<h2>تعديل الطلب</h2><form id="ef"><label>الاسم<input name="name" value="${esc(o.name)}" required></label><label>الهاتف<input name="phone" value="${esc(o.phone)}" required></label><label>العنوان<input name="addr" value="${esc(o.addr)}" required></label>
  <label>ملاحظة<textarea name="note" rows="2">${esc(o.note)}</textarea></label><label>التوصيل<select name="delivery"><option value="in" ${o.delivery === 'in' ? 'selected' : ''}>دور تو دور</option><option value="out" ${o.delivery === 'out' ? 'selected' : ''}>الوسيط</option></select></label>
  <label>الدفع<select name="pay"><option value="cash" ${o.pay === 'cash' ? 'selected' : ''}>نقدي</option><option value="transfer" ${o.pay === 'transfer' ? 'selected' : ''}>تحويل إلكتروني</option></select></label>
  <p><button>حفظ</button> <button type="button" class="ghost" data-close>إلغاء</button></p></form>`);
  $('#ef').onsubmit = async e => { e.preventDefault(); await fs.updateDoc(fs.doc(db, 'orders', o.id), Object.fromEntries(new FormData(e.target))); closeDlg(); toast('تم حفظ التعديل'); };
}
function confirmDlg(msg, fn) {
  openDlg(`<p>${msg}</p><div class="row"><button class="danger" id="yes">نعم، احذف</button><button class="ghost" data-close>إلغاء</button></div>`);
  $('#yes').onclick = async () => { closeDlg(); try { await fn(); toast('تم الحذف'); } catch (e) { toast('تعذر الحذف'); } };
}
function exportPng() {
  const m = $('#rg').value, a = $('#d1').value, b = $('#d2').value, now = new Date();
  const list = orders.filter(o => { const d = dateOf(o);
    if (m === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (m === 'week') return d >= new Date(Date.now() - 7 * 864e5);
    return a && b && d >= new Date(a) && d <= new Date(new Date(b).getTime() + 864e5 - 1); });
  if (!list.length) { toast('لا توجد طلبات في هذه الفترة'); return; }
  const W = 1000, H = 110 + list.length * 130, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#B9529F'; x.fillRect(0, 0, W, 80);
  x.direction = 'rtl'; x.textAlign = 'right'; x.fillStyle = '#fff'; x.font = 'bold 30px "IBM Plex Sans Arabic",Tahoma,sans-serif';
  x.fillText(`مستر كاندي - الطلبات (${list.length}) - المجموع ${list.reduce((s, o) => s + o.total, 0).toLocaleString('en')} د.ع`, W - 24, 52);
  list.forEach((o, i) => { const y = 100 + i * 130; x.fillStyle = i % 2 ? '#fff' : '#f6e6f1'; x.fillRect(0, y - 8, W, 130); x.fillStyle = '#2a1626';
    x.font = 'bold 22px "IBM Plex Sans Arabic",Tahoma,sans-serif'; x.fillText(`${o.code || o.id} · ${STATUS[o.status]} · ${o.total.toLocaleString('en')} د.ع · ${dateOf(o).toLocaleDateString('ar-IQ')}`, W - 24, y + 22);
    x.font = '20px "IBM Plex Sans Arabic",Tahoma,sans-serif'; x.fillText(`${o.name} · ${o.phone} · ${o.addr}`, W - 24, y + 54);
    x.fillText(`${o.items.map(t => t.name + '×' + t.qty).join('، ')} · ${o.delivery === 'in' ? 'دور تو دور' : 'الوسيط'} · ${o.pay === 'cash' ? 'نقدي' : 'تحويل'}`, W - 24, y + 84);
    if (o.note) x.fillText('ملاحظة: ' + o.note, W - 24, y + 112); });
  c.toBlob(bl => { const u = URL.createObjectURL(bl), l = document.createElement('a'); l.href = u; l.download = 'mr-candy-orders.png'; l.click(); setTimeout(() => URL.revokeObjectURL(u), 3000); }, 'image/png');
}

/* ---------- الصور: تُصغَّر وتُحفظ داخل Firestore (بدون Firebase Storage) ---------- */
async function upload(file, maxSide = 700, forceType) {
  const bmp = await createImageBitmap(file), k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const type = forceType || (c.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg');
  let q = .8, url = c.toDataURL(type, q);
  while (url.length > 300000 && q > .4) { q -= .1; url = c.toDataURL(type, q); }
  if (url.length > 700000) throw new Error('الصورة كبيرة جداً، اختر صورة أصغر');
  return url;
}
const delImg = () => null;

/* ---------- المنتجات ---------- */
function rProducts() {
  $('#view').innerHTML = `<p><button id="addP">إضافة منتج</button></p><div class="tw"><table><tr><th></th><th>المنتج</th><th>القسم</th><th>السعر</th><th>الكمية</th><th>متوفر</th><th></th></tr>
  ${prods.map(p => `<tr><td>${p.imageUrl ? `<img class="thumb" src="${esc(p.imageUrl)}" alt="">` : '<div class="thumb"></div>'}</td><td>${esc(p.name)}</td><td>${esc((cats.find(c => c.id === p.categoryId) || {}).name || '-')}</td><td>${fmt(p.price)}</td>
  <td><input type="number" min="0" style="width:90px" data-stock="${p.id}" value="${p.stock}" aria-label="الكمية"></td><td><input type="checkbox" data-act="${p.id}" ${p.active !== false ? 'checked' : ''} aria-label="متوفر"></td>
  <td><button class="ghost" data-editp="${p.id}">تعديل</button> <button class="danger" data-delp="${p.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="7">لا توجد منتجات بعد.</td></tr>'}</table></div>`;
}
function productDlg(p) {
  const n = !p; p = p || { name: '', price: 0, stock: 0, active: true, desc: '', categoryId: '' };
  openDlg(`<h2>${n ? 'إضافة منتج' : 'تعديل المنتج'}</h2><form id="pf"><label>الاسم<input name="name" value="${esc(p.name)}" required></label>
  <label>القسم<select name="categoryId"><option value="">بدون قسم</option>${cats.map(c => `<option value="${c.id}" ${p.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
  <div class="g3"><label>السعر (د.ع)<input type="number" name="price" min="0" value="${p.price}" required></label><label>الكمية<input type="number" name="stock" min="0" value="${p.stock}" required></label></div>
  <label>وصف / نكهة<input name="desc" value="${esc(p.desc)}"></label><label class="row"><input type="checkbox" name="active" style="width:auto" ${p.active !== false ? 'checked' : ''}> متوفر للبيع</label>
  <label>الصورة (اختياري)<input type="file" name="img" accept="image/*"></label><p><button id="ps">حفظ</button> <button type="button" class="ghost" data-close>إلغاء</button></p></form>`);
  $('#pf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), b = $('#ps'); b.disabled = true; b.textContent = 'جاري الحفظ...';
    try {
      const data = { name: f.get('name').trim(), categoryId: f.get('categoryId'), price: Number(f.get('price')), stock: Math.max(0, Math.floor(Number(f.get('stock')))), desc: f.get('desc').trim(), active: f.get('active') === 'on' };
      const file = f.get('img');
      if (file && file.size) { data.imageUrl = await upload(file); if (!n) await delImg(p.imageUrl); }
      if (n) await fs.setDoc(fs.doc(fs.collection(db, 'products')), { ...data, ratingSum: 0, ratingCount: 0, createdAt: fs.serverTimestamp() });
      else await fs.updateDoc(fs.doc(db, 'products', p.id), data);
      closeDlg(); toast('تم الحفظ');
    } catch (err) { console.error(err); toast('تعذر الحفظ: ' + (err.code || err.message)); b.disabled = false; b.textContent = 'حفظ'; }
  };
}

/* ---------- العروض والبوكسات ---------- */
const endOf = o => (o.endsAt && o.endsAt.toDate) ? o.endsAt.toDate() : null;
function rOffers() {
  $('#view').innerHTML = `<p><button id="addO">إضافة عرض / بوكس</button></p><div class="tw"><table><tr><th></th><th>العنوان</th><th>النوع</th><th>السعر</th><th>ينتهي</th><th>الحالة</th><th></th></tr>
  ${offers.map(o => { const e = endOf(o), ex = e && e <= new Date(); return `<tr><td>${o.imageUrl ? `<img class="thumb" src="${esc(o.imageUrl)}" alt="">` : '🎁'}</td><td>${esc(o.title)}</td><td>${o.type === 'box' ? 'بوكس' : 'عرض'}</td><td>${fmt(o.price)}</td><td>${e ? e.toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }) : 'مفتوح'}</td>
  <td>${ex ? '<span class="st s-canceled">منتهي</span>' : (o.active === false ? '<span class="st">مخفي</span>' : '<span class="st s-completed">فعّال</span>')}</td><td><button class="ghost" data-edito="${o.id}">تعديل</button> <button class="danger" data-delo2="${o.id}">حذف</button></td></tr>`; }).join('') || '<tr><td colspan="7">لا توجد عروض بعد.</td></tr>'}</table></div>`;
}
function offerDlg(o) {
  const n = !o; o = o || { title: '', type: 'box', price: 0, desc: '', items: [], brandIds: [], active: true };
  const qtyOf = id => ((o.items || []).find(c => c.id === id) || {}).qty || 0, e = endOf(o);
  const endVal = e ? new Date(e.getTime() - e.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  openDlg(`<h2>${n ? 'إضافة عرض / بوكس' : 'تعديل العرض'}</h2><form id="of"><label>العنوان<input name="title" value="${esc(o.title)}" required></label>
  <div class="g3"><label>النوع<select name="type"><option value="box" ${o.type === 'box' ? 'selected' : ''}>بوكس</option><option value="offer" ${o.type === 'offer' ? 'selected' : ''}>عرض</option></select></label><label>سعر العرض (د.ع)<input type="number" min="0" name="price" value="${o.price}" required></label></div>
  <label>الوصف<input name="desc" value="${esc(o.desc || '')}"></label>
  <b>محتويات العرض (اكتب الكمية لكل منتج، وصفر يعني غير مشمول)</b><div class="plist">${prods.map(p => `<div class="row"><span>${esc(p.name)} <small class="mut">(${fmt(p.price)})</small></span><input type="number" min="0" data-oq="${p.id}" value="${qtyOf(p.id)}" aria-label="كمية ${esc(p.name)}"></div>`).join('') || '<p class="hint">أضف منتجات أولاً.</p>'}</div>
  <div id="orig" class="hint" style="margin-top:8px"></div>
  <b>شعارات تظهر في زاوية العرض (حتى 3)</b><div>${brands.map(b => `<label class="brandchk"><input type="checkbox" name="b" value="${b.id}" ${(o.brandIds || []).includes(b.id) ? 'checked' : ''}><img src="${esc(b.logoUrl)}" alt="">${esc(b.name)}</label>`).join('') || '<p class="hint">أضف شعارات من تبويب "الشعارات".</p>'}</div>
  <label>تاريخ ووقت انتهاء العرض (اتركه فارغاً لعرض بلا مؤقت)<input type="datetime-local" name="end" value="${endVal}"></label>
  <label>صورة العرض (اختياري)<input type="file" name="img" accept="image/*"></label><label class="row"><input type="checkbox" name="active" style="width:auto" ${o.active !== false ? 'checked' : ''}> ظاهر للزبائن</label>
  <p><button id="os">حفظ</button> <button type="button" class="ghost" data-close>إلغاء</button></p></form>`);
  const calc = () => { const t = $$('[data-oq]').reduce((a, i) => a + (Number(i.value) || 0) * (prods.find(p => p.id === i.dataset.oq) || { price: 0 }).price, 0); $('#orig').textContent = 'مجموع أسعار المحتويات بالسعر العادي: ' + fmt(t); };
  $('#of').addEventListener('input', calc); calc();
  $('#of').onsubmit = async ev => {
    ev.preventDefault(); const f = new FormData(ev.target), b = $('#os');
    const items = $$('[data-oq]').map(i => ({ id: i.dataset.oq, qty: Math.floor(Number(i.value)) || 0 })).filter(i => i.qty > 0).map(i => ({ ...i, name: prods.find(p => p.id === i.id).name }));
    if (!items.length) { toast('اختر منتجاً واحداً على الأقل'); return; }
    const bids = f.getAll('b'); if (bids.length > 3) { toast('الحد الأقصى 3 شعارات'); return; }
    b.disabled = true; b.textContent = 'جاري الحفظ...';
    try {
      const data = { title: f.get('title').trim(), type: f.get('type'), price: Number(f.get('price')), desc: f.get('desc').trim(), items, brandIds: bids, active: f.get('active') === 'on', endsAt: f.get('end') ? fs.Timestamp.fromDate(new Date(f.get('end'))) : null };
      const file = f.get('img'); if (file && file.size) data.imageUrl = await upload(file);
      if (n) await fs.setDoc(fs.doc(fs.collection(db, 'offers')), { ...data, createdAt: fs.serverTimestamp() }); else await fs.updateDoc(fs.doc(db, 'offers', o.id), data);
      closeDlg(); toast('تم الحفظ');
    } catch (err) { console.error(err); toast('تعذر الحفظ: ' + (err.code || err.message)); b.disabled = false; b.textContent = 'حفظ'; }
  };
}

/* ---------- الشعارات (نستلة، حلويات...) ---------- */
function rBrands() {
  $('#view').innerHTML = `<form id="bf" class="panel row"><input name="n" placeholder="اسم الشركة / الماركة" required style="max-width:240px"><input type="file" name="f" accept="image/*" required style="max-width:260px"><button>إضافة شعار</button></form>
  <div class="hint" style="margin-bottom:12px">يفضّل شعار بخلفية شفافة (PNG). يُصغَّر تلقائياً إلى 160px.</div>
  ${brands.map(b => `<div class="panel row"><img class="thumb" src="${esc(b.logoUrl)}" alt="" style="object-fit:contain"><b style="flex:1">${esc(b.name)}</b><button class="danger" data-delb="${b.id}">حذف</button></div>`).join('') || '<p class="hint">لا توجد شعارات بعد.</p>'}`;
  $('#bf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), btn = e.target.querySelector('button'); btn.disabled = true;
    try { const logoUrl = await upload(f.get('f'), 160, 'image/png'); await fs.addDoc(fs.collection(db, 'brands'), { name: f.get('n').trim(), logoUrl, createdAt: fs.serverTimestamp() }); toast('تمت الإضافة'); }
    catch (err) { console.error(err); toast('تعذر الإضافة: ' + (err.code || err.message)); } btn.disabled = false; };
}

/* ---------- مراجعة التحويلات ---------- */
const RVS = { awaiting_review: 'بانتظار المراجعة', confirmed: 'تم قبول التحويل', rejected: 'تم رفض التحويل', awaiting_transfer: 'لم يتم إرسال الإثبات', all: 'الكل' };
const ML = { phone: 'رقم الهاتف', qr: 'QR Code', account: 'رقم الحساب / البطاقة' };
function rReview() {
  const ps = o => (o.payment || {}).status;
  const l = orders.filter(o => o.pay === 'transfer').filter(o => rv === 'all' || ps(o) === rv || (rv === 'rejected' && ps(o) === 'awaiting_new_proof'));
  $('#view').innerHTML = `<div class="subtabs">${Object.keys(RVS).map(k => `<button data-rvf="${k}" class="${rv === k ? 'on' : ''}">${RVS[k]}</button>`).join('')}</div>
  <div class="tw"><table><tr><th>الطلب</th><th>الزبون</th><th>المبلغ</th><th>الطريقة</th><th>تاريخ الإثبات</th><th>حالة الدفع</th><th>حالة الطلب</th><th></th></tr>
  ${l.map(o => { const p = o.payment || {}, t = p.proof && p.proof.uploadedAt && p.proof.uploadedAt.toDate ? p.proof.uploadedAt.toDate().toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
    return `<tr><td dir="ltr"><b>${esc(o.code || o.id)}</b></td><td>${esc(o.name)}<br>${esc(o.phone)}</td><td>${fmt(o.total)}</td><td>${ML[p.method] || '-'}</td><td>${t}</td><td><span class="st">${PAYST[p.status] || ''}</span></td><td><span class="st s-${o.status}">${STATUS[o.status]}</span></td><td><button class="ghost" data-rvo="${o.id}">فتح</button></td></tr>`; }).join('') || '<tr><td colspan="8">لا توجد عمليات في هذا القسم.</td></tr>'}</table></div>`;
}
async function reviewDlg(o) {
  const p = o.payment || {}, h = (p.history || []).slice().reverse();
  openDlg(`<h2>مراجعة التحويل</h2><p><b dir="ltr">${esc(o.code || o.id)}</b> · ${PAYST[p.status] || ''}</p>
  <div class="line"><span>الزبون</span><span>${esc(o.name)} · ${esc(o.phone)}</span></div><div class="line"><span>العنوان</span><span>${esc(o.addr)}</span></div>
  <div class="line"><span>المنتجات</span><span>${(o.items || []).map(i => esc(i.name) + ' × ' + i.qty).join('، ')}</span></div>
  <div class="line"><span>إجمالي المطلوب</span><b>${fmt(o.total)}</b></div><div class="line"><span>طريقة التحويل</span><span>${ML[p.method] || '-'}</span></div>
  ${p.totalMismatch ? '<p class="warn">تنبيه: مجموع الطلب لا يطابق حساب الأسعار الحالية في الخادم. راجع الأسعار قبل القبول.</p>' : ''}
  <div id="pimg" class="hint">جاري تحميل صورة الإثبات...</div>
  ${p.status === 'awaiting_review' ? `<label>سبب الرفض / ملاحظة للزبون (مطلوبة عند الرفض أو طلب إثبات جديد)<textarea id="rnote" rows="2"></textarea></label>
  <div class="row"><button id="racc">قبول التحويل</button><button class="danger" id="rrej">رفض التحويل</button><button class="ghost" id="rres">طلب إعادة إرسال الإثبات</button></div>` : ''}
  ${h.length ? `<b>سجل المراجعات</b><ul class="hist">${h.map(x => `<li>${new Date(x.at).toLocaleString('ar-IQ')} · ${esc(x.by)} · ${({ proof_submitted: 'إرسال إثبات', accepted: 'قبول', rejected: 'رفض', resend_requested: 'طلب إثبات جديد' })[x.action] || x.action} ${x.note ? '· ' + esc(x.note) : ''}</li>`).join('')}</ul>` : ''}
  <p><button class="ghost" data-close>إغلاق</button></p>`);
  const go = async d => {
    const note = ($('#rnote') || {}).value || '';
    if (d !== 'accept' && !note.trim()) { toast('اكتب السبب أولاً'); return; }
    ['racc', 'rrej', 'rres'].forEach(i => { const b = $('#' + i); if (b) b.disabled = true; });
    try { await api('review', { code: o.id, decision: d, note }, await tok()); toast('تم تنفيذ القرار'); closeDlg(); }
    catch (e) { toast(e.message); ['racc', 'rrej', 'rres'].forEach(i => { const b = $('#' + i); if (b) b.disabled = false; }); }
  };
  if ($('#racc')) { $('#racc').onclick = () => go('accept'); $('#rrej').onclick = () => go('reject'); $('#rres').onclick = () => go('resend'); }
  try { const r = await api('proofUrl', { code: o.id }, await tok()); const x = $('#pimg'); if (x) x.outerHTML = `<img class="proofimg" data-zoom src="${r.dataUrl}" alt="إثبات التحويل (اضغط للتكبير)">`; }
  catch (e) { const x = $('#pimg'); if (x) x.textContent = p.proof ? 'تعذر تحميل الصورة: ' + e.message : 'لم يرسل الزبون إثباتاً بعد.'; }
}

/* ---------- إعدادات الدفع والتحويل ---------- */
function rPaySet() {
  const m = pay.methods || {}, v = pay.video || {};
  const sec = k => { const x = m[k] || {}, d = MDEF[k];
    return `<div class="panel"><h3>${d.icon} ${d.title}</h3><label class="row"><input type="checkbox" name="${k}_en" style="width:auto" ${x.enabled ? 'checked' : ''}> تفعيل هذه الطريقة</label>
    <div class="g3"><label>العنوان الظاهر للزبون<input name="${k}_title" value="${esc(x.title || d.title)}"></label><label>اسم المستفيد<input name="${k}_ben" value="${esc(x.beneficiary || '')}"></label><label>الترتيب (الأصغر أولاً)<input type="number" name="${k}_ord" value="${x.order ?? MKEYS.indexOf(k) + 1}"></label></div>
    ${k === 'qr' ? `<label>صورة QR (JPG أو PNG أو WEBP)<input type="file" name="qr_file" accept="image/*"></label>${x.imageUrl ? `<div class="row"><img class="qrimg sm" src="${esc(x.imageUrl)}" alt="QR الحالي"><button type="button" class="danger" id="delQr">حذف الصورة</button></div>` : ''}`
      : `<label>${k === 'phone' ? 'رقم الهاتف' : 'رقم الحساب / البطاقة'}<input name="${k}_num" dir="ltr" value="${esc(x.number || '')}"></label>`}
    <label>تعليمات التحويل<textarea name="${k}_ins" rows="2">${esc(x.instructions || '')}</textarea></label></div>`; };
  $('#view').innerHTML = `<div class="hint" style="margin-bottom:12px">كل طريقة مستقلة: عطّل أيّاً منها فتختفي من واجهة الزبون. إذا عطّلتها كلها يتوقف خيار التحويل الإلكتروني تلقائياً.</div>
  <form id="pform">${MKEYS.map(sec).join('')}<div class="panel"><h3>🎬 فيديو شرح التحويل</h3><label class="row"><input type="checkbox" name="v_en" style="width:auto" ${v.enabled ? 'checked' : ''}> إظهار الفيديو</label>
  <label>رابط الفيديو (يوتيوب أو رابط mp4 مباشر)<input name="v_url" dir="ltr" value="${esc(v.url || '')}"></label><div class="g3"><label>العنوان<input name="v_title" value="${esc(v.title || '')}"></label><label>الوصف<input name="v_desc" value="${esc(v.desc || '')}"></label></div>
  <button type="button" class="ghost" id="delVid">حذف الفيديو</button></div><p class="row"><button id="psv">حفظ الإعدادات</button><button type="button" class="ghost" id="prev">معاينة كما تظهر للزبائن</button></p></form>`;
  $('#pform').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), b = $('#psv'); b.disabled = true; b.textContent = 'جاري الحفظ...';
    try {
      const old = (pay.methods || {}).qr || {}, methods = {};
      for (const k of MKEYS) methods[k] = { enabled: f.get(k + '_en') === 'on', title: f.get(k + '_title').trim(), beneficiary: f.get(k + '_ben').trim(), order: Number(f.get(k + '_ord')) || 0, instructions: f.get(k + '_ins').trim() };
      methods.phone.number = f.get('phone_num').trim(); methods.account.number = f.get('account_num').trim();
      methods.qr.imageUrl = old.imageUrl || ''; methods.qr.publicId = old.publicId || '';
      const file = f.get('qr_file');
      if (file && file.size) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('صورة QR يجب أن تكون JPG أو PNG أو WEBP وأقل من 5MB');
        methods.qr.imageUrl = await upload(file, 700);
      }
      const url = f.get('v_url').trim(); if (url && !/^https?:\/\//i.test(url)) throw new Error('رابط الفيديو يجب أن يبدأ بـ https://');
      await fs.setDoc(fs.doc(db, 'settings', 'payment'), { methods, video: { enabled: f.get('v_en') === 'on', url, title: f.get('v_title').trim(), desc: f.get('v_desc').trim() } });
      toast('تم حفظ إعدادات الدفع');
    } catch (err) { console.error(err); toast(err.message || 'تعذر الحفظ'); }
    b.disabled = false; b.textContent = 'حفظ الإعدادات';
  };
}

/* ---------- الأقسام ---------- */
function rCats() {
  $('#view').innerHTML = `<form id="cf" class="panel row"><input name="n" placeholder="اسم القسم الجديد" required style="max-width:320px"><button>إضافة قسم</button></form>
  ${cats.map(c => `<div class="panel row"><input value="${esc(c.name)}" data-cn="${c.id}" aria-label="اسم القسم" style="max-width:260px"><input type="number" value="${c.order ?? 0}" data-co="${c.id}" aria-label="الترتيب" style="width:90px"><button class="danger" data-delc="${c.id}">حذف</button></div>`).join('') || '<p class="hint">أضف أقساماً مثل: شوكولاتة أوروبية، سناكس مستوردة، مشروبات وعصائر.</p>'}`;
  $('#cf').onsubmit = async e => { e.preventDefault(); const v = new FormData(e.target).get('n').trim(); await fs.addDoc(fs.collection(db, 'categories'), { name: v, order: cats.length }); e.target.reset(); };
}

/* ---------- إعدادات الموقع ---------- */
function rSettings() {
  const s = Object.assign({ title: '', sub: '', about: '', feeIn: 3000, feeOut: 5000 }, site);
  $('#view').innerHTML = `<form id="sf" class="panel"><label>عنوان الواجهة<input name="title" value="${esc(s.title)}"></label><label>نص فرعي<textarea name="sub" rows="2">${esc(s.sub)}</textarea></label>
  <label>نص "عن المتجر"<textarea name="about" rows="3">${esc(s.about)}</textarea></label><div class="g3"><label>أجور دور تو دور (د.ع)<input type="number" min="0" name="feeIn" value="${s.feeIn}"></label><label>أجور الوسيط (د.ع)<input type="number" min="0" name="feeOut" value="${s.feeOut}"></label></div>
  <label>الشعار (يستبدل الحالي)<input type="file" name="logo" accept="image/*"></label>${s.logoUrl ? `<img class="logo" src="${esc(s.logoUrl)}" alt="الشعار الحالي">` : ''}<p><button id="ss">حفظ الإعدادات</button></p></form>`;
  $('#sf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), b = $('#ss'); b.disabled = true;
    try {
      const d = { title: f.get('title').trim(), sub: f.get('sub').trim(), about: f.get('about').trim(), feeIn: Number(f.get('feeIn')) || 0, feeOut: Number(f.get('feeOut')) || 0 };
      const file = f.get('logo'); if (file && file.size) { d.logoUrl = await upload(file, 400); await delImg(site.logoUrl); }
      await fs.setDoc(fs.doc(db, 'settings', 'site'), d, { merge: true }); toast('تم حفظ الإعدادات'); rSettings();
    } catch (err) { console.error(err); toast('تعذر الحفظ: ' + (err.code || err.message)); }
    b.disabled = false;
  };
}

/* ---------- الأحداث ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return; const d = t.dataset;
  try {
    if (d.sub) { sub = d.sub; render(); }
    else if (t.id === 'exp') exportPng();
    else if (d.copy) { await navigator.clipboard.writeText(summaryText(ord(d.copy))); toast('تم نسخ ملخص الطلب'); }
    else if (d.edit) editOrder(ord(d.edit));
    else if (d.pin) await fs.updateDoc(fs.doc(db, 'orders', d.pin), { pinned: !ord(d.pin).pinned });
    else if (d.delo) confirmDlg('حذف هذا الطلب نهائياً؟', () => fs.deleteDoc(fs.doc(db, 'orders', d.delo)));
    else if (t.id === 'addP') productDlg(null);
    else if (d.editp) productDlg(prods.find(p => p.id === d.editp));
    else if (d.delp) { const p = prods.find(x => x.id === d.delp); confirmDlg(`حذف المنتج "${esc(p.name)}"؟`, async () => { await fs.deleteDoc(fs.doc(db, 'products', p.id)); await delImg(p.imageUrl); }); }
    else if (d.rvf) { rv = d.rvf; render(); }
    else if (d.rvo) reviewDlg(ord(d.rvo));
    else if (t.id === 'prev') { const ms = activeMethods(pay); openDlg('<h2>معاينة صفحة التحويل</h2>' + (videoHtml(pay.video) + ms.map(x => methodCard(x, 25000, 'اختيار هذه الطريقة')).join('') || '<p class="hint">لا توجد طرق مفعّلة.</p>') + '<p><button data-close>إغلاق</button></p>'); }
    else if (t.id === 'delVid') { await fs.setDoc(fs.doc(db, 'settings', 'payment'), { video: { enabled: false, url: '', title: '', desc: '' } }, { merge: true }); toast('تم حذف الفيديو'); rPaySet(); }
    else if (t.id === 'delQr') confirmDlg('حذف صورة QR؟', async () => { await fs.setDoc(fs.doc(db, 'settings', 'payment'), { methods: { qr: { imageUrl: '', publicId: '', enabled: false } } }, { merge: true }); });
    else if (t.id === 'addO') offerDlg(null);
    else if (d.edito) offerDlg(offers.find(x => x.id === d.edito));
    else if (d.delo2) confirmDlg('حذف هذا العرض؟', () => fs.deleteDoc(fs.doc(db, 'offers', d.delo2)));
    else if (d.delb) confirmDlg('حذف هذا الشعار؟', () => fs.deleteDoc(fs.doc(db, 'brands', d.delb)));
    else if (d.delc) confirmDlg('حذف هذا القسم؟ (المنتجات تبقى بدون قسم)', () => fs.deleteDoc(fs.doc(db, 'categories', d.delc)));
  } catch (err) { console.error(err); toast('حدث خطأ: ' + (err.code || err.message)); }
});
document.addEventListener('change', async e => {
  const t = e.target, d = t.dataset;
  try {
    if (d.st) await setStatus(d.st, t.value);
    else if (d.stock) { await fs.updateDoc(fs.doc(db, 'products', d.stock), { stock: Math.max(0, Math.floor(Number(t.value)) || 0) }); toast('تم تحديث الكمية'); }
    else if (d.act) await fs.updateDoc(fs.doc(db, 'products', d.act), { active: t.checked });
    else if (d.cn) await fs.updateDoc(fs.doc(db, 'categories', d.cn), { name: t.value.trim() });
    else if (d.co) await fs.updateDoc(fs.doc(db, 'categories', d.co), { order: Number(t.value) || 0 });
  } catch (err) { console.error(err); toast(err.message || 'حدث خطأ'); if (d.st) render(); }
});
