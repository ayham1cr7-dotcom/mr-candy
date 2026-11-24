# مستر كاندي (Mr. Candy) — متجر إلكتروني عربي RTL

موقع ثابت (HTML + JavaScript بدون خطوة بناء) متصل بـ Firebase (Firestore + Authentication، بدون Storage) ويُنشر على Netlify.
أي تعديل من لوحة الإدارة يظهر لحظياً لكل الزوار عبر `onSnapshot`.

## هيكل المشروع
```
public/
  index.html        المتجر
  admin.html        لوحة الإدارة (/admin)
  css/              style.css (المتجر) + admin.css
  js/store.js       منطق المتجر والسلة والطلبات والتتبع والتقييم
  js/admin.js       الدخول، الطلبات، المنتجات، الأقسام، الإعدادات
  js/firebase.js    تهيئة Firebase
  js/common.js      دوال مشتركة
  js/config.js      يُولَّد تلقائياً (غير موجود في Git)
  assets/logo.png   الشعار الافتراضي
scripts/gen-config.js   يولّد config.js من متغيرات البيئة
netlify.toml            إعدادات النشر
firestore.rules   قواعد الأمان
```

## نموذج البيانات (Firestore)
- `settings/site`: العنوان، النص الفرعي، عن المتجر، أجور التوصيل `feeIn` و`feeOut`، `logoUrl`
- `categories/{id}`: `name`, `order`
- `products/{id}`: `name, categoryId, price, stock, active, desc, imageUrl, ratingSum, ratingCount, createdAt`
  - `products/{id}/reviews/{rid}`: `stars, comment, createdAt`
- `orders/{MC-XXXXXXXX}`: بيانات الزبون والمنتجات والمبالغ و`status` و`pinned` و`inventoryDeducted`
- `admins/{uid}`: وجود المستند يعني أن المستخدم أدمن (يُنشأ يدوياً فقط)

## الخطوة 1: Firebase Console
1. افتح https://console.firebase.google.com ثم **Add project** (اسمه مثلاً `mr-candy`). تعطيل Google Analytics خيار مقبول.
2. **Build ← Authentication ← Get started ← Email/Password ← Enable ← Save**.
3. من تبويب **Users** اضغط **Add user** وأدخل بريدك وكلمة مرور قوية. انسخ **User UID** لهذا الحساب.
4. **Build ← Firestore Database ← Create database** (اختر Production mode، وموقعاً قريباً مثل `eur3` أو `europe-west`).
5. أنشئ مستند الأدمن: في Firestore اضغط **Start collection** باسم `admins`، و**Document ID** = الـ UID الذي نسخته، وأضف أي حقل (مثلاً `role` = `admin`).
6. **Firestore ← Rules**: الصق محتوى `firestore.rules` ثم **Publish**.
8. **Project settings (⚙️) ← General ← Your apps ← Web (</>)**: سجّل تطبيقاً، وانسخ قيم `firebaseConfig` (apiKey, authDomain, projectId, messagingSenderId, appId).

> **ملاحظة:** نسخة المشروع هذه تحوي `public/js/config.js` جاهزاً بإعدادات مشروع `mr-candy-33e96`، فيمكنك تخطي `.env` ومتغيرات Netlify. مفاتيح Firebase للويب ليست أسراراً، والحماية بالقواعد.

## الخطوة 2: داخل المشروع (تجربة محلية)
```bash
cp .env.example .env        # ثم الصق القيم الخمس داخل .env
node scripts/gen-config.js  # يولّد public/js/config.js
npx serve public            # أو: python3 -m http.server -d public 8000
```
افتح `http://localhost:3000` للمتجر و`/admin.html` للإدارة. (لا تفتح الملفات بالنقر المزدوج؛ وحدات ES تحتاج خادماً.)
في Firebase: **Authentication ← Settings ← Authorized domains** تأكد من وجود `localhost`.

## الخطوة 3: النشر على Netlify
1. ارفع المجلد إلى مستودع GitHub (ملف `.env` و`config.js` مستثنيان تلقائياً عبر `.gitignore`).
2. في Netlify: **Add new site ← Import an existing project** واختر المستودع. الإعدادات تُقرأ من `netlify.toml` (أمر البناء `node scripts/gen-config.js` ومجلد النشر `public`).
3. **Site configuration ← Environment variables**: أضف المتغيرات الخمسة بالأسماء نفسها:
   `FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID`
4. اضغط **Deploy**. بدون هذه المتغيرات يفشل البناء برسالة تذكر الناقص.
5. بعد النشر: انسخ نطاق الموقع (مثل `xxxx.netlify.app`) وأضفه في Firebase: **Authentication ← Settings ← Authorized domains ← Add domain**. بدونه لن يعمل تسجيل الدخول على الموقع المنشور.
6. اختبار الربط: افتح `/admin` وسجّل الدخول، أضف قسماً ومنتجاً بصورة، ثم افتح الموقع في جهاز آخر وتأكد أن المنتج ظهر دون تحديث الصفحة.

## أول استخدام
من `/admin`: **الأقسام** (أضف أقسامك) ثم **المنتجات** (الاسم، السعر، الكمية، الصورة) ثم **إعدادات الموقع** (النصوص، أجور التوصيل، الشعار).

## الصور: أين وكيف
> الصور تُحفظ داخل Firestore (حد المستند 1MB، والصورة تُضغط تلقائياً لأقل من ~300KB). مناسب لعدد منتجات صغير ومتوسط؛ إذا كبر المتجر كثيراً فالأفضل الانتقال لاستضافة صور منفصلة.
- **صور المنتجات والشعار**: تُرفع من لوحة الإدارة مباشرة (تُصغَّر إلى 700px تقريباً وتُحفظ مضغوطة داخل مستند المنتج في Firestore، بدون Storage أو اشتراك).
- **الشعار الافتراضي** قبل الرفع: `public/assets/logo.png`.
- عند إرسال صورة لـ Claude Code قل مثلاً: «هذه صورة المنتج X، ضعها في `public/assets/products/` واربطها بالمنتج» أو «هذا الشعار الجديد، استبدل به `public/assets/logo.png`».

## ملاحظات أمان وحدود
- **تسجيل الدخول** عبر Firebase Auth فقط، والصلاحية من وجود `admins/{uid}`؛ لا توجد أرقام سرية في الكود. القواعد في `firestore.rules` هي خط الدفاع الحقيقي لا الواجهة.
- **المخزون** يُخصم عند اعتماد الأدمن "تم الإتمام" بـ Transaction مع `inventoryDeducted`، فلا يتكرر الخصم. وإذا لم يكفِ المخزون يُرفض الاعتماد برسالة.
- **الأسعار**: الزبون يرسل مجموع الطلب من المتصفح، والقواعد لا تستطيع إعادة حسابه. راجع المبالغ قبل التجهيز. للحماية الكاملة استخدم Cloud Function (تتطلب خطة Blaze).
- **التقييمات** مفتوحة للزوار (حد أقصى لكل متصفح عبر localStorage فقط، ويمكن تجاوزه). لمنع الإساءة فعّل **App Check** لاحقاً.
- **تتبع الطلب**: أي شخص يعرف رمز الطلب العشوائي (8 خانات) يرى تفاصيله.
- **ماستر كارد**: الخيار يُسجَّل في الطلب فقط، ولا توجد بوابة دفع إلكتروني. اربط بوابة (مثل Qi Card / ZainCash / Stripe حسب المتاح) عند الحاجة.
- مفاتيح Firebase للويب ليست أسراراً بحد ذاتها؛ ولذلك ضُبط `SECRETS_SCAN_OMIT_KEYS` في `netlify.toml` كي لا يفشل البناء.

## استكشاف الأخطاء
- **"هذا الحساب ليس لديه صلاحية الإدارة"**: مستند `admins/{UID}` غير موجود أو الـ UID خاطئ.
- **`auth/unauthorized-domain`**: أضف نطاق Netlify في Authorized domains.
- **`permission-denied`**: لم تُنشر القواعد بعد، أو الحساب ليس أدمن.
- **صفحة بيضاء/خطأ `config.js`**: لم تشغّل `gen-config.js` أو لم تضف متغيرات Netlify.
- **الاستعلام يطلب index**: اضغط الرابط الذي يظهر في Console لإنشائه.

## نظام التحويل اليدوي (Netlify Functions + Firestore)
- الدالة الخادمية: `netlify/functions/api.js` (تتبع الطلب، حفظ/عرض إثبات التحويل، مراجعة الدفع).
- صور الإثبات تُحفظ مضغوطة (حتى ~450KB) في مجموعة `proofs` المقفلة بالقواعد، ولا يقرؤها إلا الخادم.
- متغيرات Netlify السرية: `FB_PROJECT_ID, FB_CLIENT_EMAIL, FB_PRIVATE_KEY` (من مفتاح خدمة Firebase). لا تضعها في الكود ولا ترفع ملف المفتاح على GitHub.
- النشر يتم من GitHub (السحب والإفلات لا ينشر الدوال).
- طرق التحويل والفيديو تُدار من لوحة الإدارة ← "إعدادات الدفع والتحويل".
