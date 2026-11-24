// يولّد public/js/config.js من متغيرات البيئة (Netlify) أو من ملف .env محلياً
const fs = require('fs');
let env = {};
try {
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}
env = Object.assign(env, process.env);
const keys = { apiKey: 'API_KEY', authDomain: 'AUTH_DOMAIN', projectId: 'PROJECT_ID', messagingSenderId: 'MESSAGING_SENDER_ID', appId: 'APP_ID' };
const cfg = {}, missing = [];
for (const [k, v] of Object.entries(keys)) {
  const val = env['FIREBASE_' + v];
  if (!val) missing.push('FIREBASE_' + v); else cfg[k] = val;
}
if (missing.length && fs.existsSync('public/js/config.js')) { console.log('استخدام public/js/config.js الموجود'); process.exit(0); }
if (missing.length) { console.error('متغيرات ناقصة: ' + missing.join(', ')); process.exit(1); }
fs.writeFileSync('public/js/config.js', 'export const firebaseConfig = ' + JSON.stringify(cfg, null, 2) + ';\n');
console.log('تم إنشاء public/js/config.js');
