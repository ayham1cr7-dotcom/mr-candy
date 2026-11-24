// واجهة خادمية واحدة: تتبع الطلب، رفع/عرض إثبات التحويل، ومراجعة المدفوعات (الأدمن فقط للعمليات الحساسة)
const admin = require('firebase-admin');

let ready = false;
function init() {
  if (ready) return;
  admin.initializeApp({ credential: admin.credential.cert({
    projectId: process.env.FB_PROJECT_ID,
    clientEmail: process.env.FB_CLIENT_EMAIL,
    privateKey: (process.env.FB_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  }) });
  ready = true;
}
const db = () => admin.firestore();
const FV = () => admin.firestore.FieldValue;
const err = (s, m) => { const e = new Error(m); e.status = s; return e; };
const res = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
const digits = s => String(s || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
const OPEN = ['awaiting_transfer', 'rejected', 'awaiting_new_proof'];

async function needAdmin(event) {
  const t = String(event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '');
  if (!t) throw err(401, 'يلزم تسجيل الدخول');
  let d; try { d = await admin.auth().verifyIdToken(t); } catch (e) { throw err(401, 'جلسة غير صالحة'); }
  const a = await db().doc('admins/' + d.uid).get();
  if (!a.exists) throw err(403, 'ليست لديك صلاحية');
  return d;
}
async function ownOrder(b) {
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^MC-[A-Z0-9]{8}$/.test(code)) throw err(400, 'رقم الطلب غير صحيح');
  const snap = await db().doc('orders/' + code).get();
  const o = snap.exists ? snap.data() : null;
  const q = digits(b.phone4).slice(-4);
  // رسالة موحدة حتى لا يُكشف وجود الطلب
  if (!o || q.length < 4 || !digits(o.phone).endsWith(q)) throw err(403, 'رقم الطلب أو آخر 4 أرقام من الهاتف غير صحيحة');
  return { ref: snap.ref, o, code };
}
const ms = t => (t && t.toMillis) ? t.toMillis() : 0;
function pub(o) {
  const p = o.payment || {};
  return { code: o.code, name: o.name, phone: o.phone, addr: o.addr, note: o.note, delivery: o.delivery, pay: o.pay, items: o.items, fee: o.fee, total: o.total, status: o.status, createdAt: ms(o.createdAt),
    payment: { status: p.status || 'cod', method: p.method || null, rejectReason: p.rejectReason || '', hasProof: !!p.proof, proofAt: ms(p.proof && p.proof.uploadedAt), updatedAt: p.updatedAt || 0 } };
}
async function serverTotal(o) {
  let sum = 0;
  for (const i of o.items) {
    const d = i.id.startsWith('o_') ? await db().doc('offers/' + i.id.slice(2)).get() : await db().doc('products/' + i.id).get();
    if (!d.exists) return null;
    sum += (i.id.startsWith('o_') ? d.data().price : d.data().price) * i.qty;
  }
  const s = (await db().doc('settings/site').get()).data() || {};
  return sum + Number(o.delivery === 'in' ? (s.feeIn ?? 3000) : (s.feeOut ?? 5000));
}
const A = {
  async track(b) { const { o } = await ownOrder(b); return { order: pub(o) }; },

  async submit(b) { // صورة الإثبات تُحفظ في مجموعة proofs المقفلة (لا يقرؤها أحد إلا هذه الدالة)
    const { ref, o, code } = await ownOrder(b);
    const p = o.payment || {};
    if (o.pay !== 'transfer' || !OPEN.includes(p.status)) throw err(409, 'لا يمكن إرسال إثبات لهذا الطلب الآن');
    if (!['phone', 'qr', 'account'].includes(b.method)) throw err(400, 'طريقة التحويل غير صحيحة');
    const mime = String(b.mime || '');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw err(400, 'نوع الصورة غير مدعوم');
    const buf = Buffer.from(String(b.image || ''), 'base64');
    if (buf.length < 500 || buf.length > 700000) throw err(400, 'حجم الصورة غير مناسب');
    const h = buf.subarray(0, 12);
    const okMagic = (mime === 'image/jpeg' && h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) ||
      (mime === 'image/png' && h.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) ||
      (mime === 'image/webp' && h.subarray(0, 4).toString() === 'RIFF' && h.subarray(8, 12).toString() === 'WEBP');
    if (!okMagic) throw err(400, 'الملف ليس صورة صالحة');
    const id = code + '-' + Date.now(), now = Date.now(), st = await serverTotal(o);
    await db().doc('proofs/' + id).set({ code, mime, size: buf.length, bytes: buf, createdAt: FV().serverTimestamp() });
    await ref.update({
      'payment.status': 'awaiting_review', 'payment.method': b.method, 'payment.rejectReason': '', 'payment.updatedAt': now,
      'payment.proof': { id, uploadedAt: FV().serverTimestamp() },
      'payment.proofs': FV().arrayUnion({ id, at: now, method: b.method }),
      'payment.totalMismatch': st === null ? true : st !== o.total,
      'payment.history': FV().arrayUnion({ at: now, by: 'customer', action: 'proof_submitted', note: b.method })
    });
    return { ok: true };
  },

  async proofUrl(b, event) { // الأدمن، أو الزبون صاحب الطلب بعد التحقق
    let o, code;
    if (b.phone4) ({ o, code } = await ownOrder(b)); else { await needAdmin(event); code = String(b.code || '').toUpperCase(); const s = await db().doc('orders/' + code).get(); if (!s.exists) throw err(404, 'غير موجود'); o = s.data(); }
    const id = b.proofId || (o.payment && o.payment.proof && o.payment.proof.id);
    if (!id || !((o.payment || {}).proofs || []).some(x => x.id === id)) throw err(404, 'لا يوجد إثبات');
    const d = await db().doc('proofs/' + id).get();
    if (!d.exists || d.data().code !== code) throw err(404, 'لا يوجد إثبات');
    const x = d.data();
    return { dataUrl: 'data:' + x.mime + ';base64,' + Buffer.from(x.bytes).toString('base64') };
  },

  async review(b, event) {
    const who = await needAdmin(event);
    const code = String(b.code || '').toUpperCase(), ref = db().doc('orders/' + code), note = String(b.note || '').trim();
    if (!['accept', 'reject', 'resend'].includes(b.decision)) throw err(400, 'قرار غير صالح');
    if (b.decision !== 'accept' && !note) throw err(400, 'اكتب السبب');
    const now = Date.now(), by = who.email || who.uid;
    return db().runTransaction(async tx => {
      const s = await tx.get(ref); if (!s.exists) throw err(404, 'الطلب غير موجود');
      const o = s.data(), p = o.payment || {};
      if (b.decision === 'accept') {
        if (p.status === 'confirmed') return { ok: true, already: true }; // يمنع التكرار
        if (p.status !== 'awaiting_review') throw err(409, 'الطلب ليس بانتظار المراجعة');
        if (!o.inventoryDeducted) {
          const need = {};
          o.items.forEach(i => (i.comps ? i.comps.map(c => ({ id: c.id, name: c.name, qty: c.qty * i.qty })) : [{ id: i.id, name: i.name, qty: i.qty }])
            .forEach(c => { need[c.id] = { name: c.name, qty: ((need[c.id] || {}).qty || 0) + c.qty }; }));
          const ids = Object.keys(need), refs = ids.map(id => db().doc('products/' + id));
          const snaps = await tx.getAll(...refs);
          snaps.forEach((d, k) => { if (!d.exists || d.data().stock < need[ids[k]].qty) throw err(409, 'المخزون لا يكفي: ' + need[ids[k]].name); });
          snaps.forEach((d, k) => tx.update(refs[k], { stock: d.data().stock - need[ids[k]].qty }));
          tx.update(ref, { inventoryDeducted: true });
        }
        tx.update(ref, { 'payment.status': 'confirmed', 'payment.reviewedBy': by, 'payment.reviewedAt': now, 'payment.updatedAt': now, 'payment.rejectReason': '',
          'payment.history': FV().arrayUnion({ at: now, by, action: 'accepted', note: '' }) });
      } else {
        if (p.status !== 'awaiting_review') throw err(409, 'الطلب ليس بانتظار المراجعة');
        const st = b.decision === 'reject' ? 'rejected' : 'awaiting_new_proof';
        tx.update(ref, { 'payment.status': st, 'payment.rejectReason': note, 'payment.reviewedBy': by, 'payment.reviewedAt': now, 'payment.updatedAt': now,
          'payment.history': FV().arrayUnion({ at: now, by, action: b.decision === 'reject' ? 'rejected' : 'resend_requested', note }) });
      }
      return { ok: true };
    });
  },
};

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return res(405, { error: 'method' });
  try {
    init();
    const b = JSON.parse(event.body || '{}'), fn = A[b.action];
    if (!fn) return res(400, { error: 'unknown action' });
    return res(200, await fn(b, event));
  } catch (e) {
    if (!e.status) console.error(e);
    return res(e.status || 500, { error: e.status ? e.message : 'خطأ في الخادم' });
  }
};
