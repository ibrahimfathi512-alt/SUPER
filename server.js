const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const session = require('express-session');
const XLSX = require('xlsx');

const app = express();

// --- الإعدادات العامة (Configuration) ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'talabat-final-pro-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // اجعلها true فقط في حالة استخدام HTTPS
}));

// معرف ملف جوجل شيت الخاص بك
const SPREADSHEET_ID = '1bNhlUVWnt43Pq1hqDALXbfGDVazD7VhaeKM58hBTsN0';

// كلمات مرور المناطق
const zonePasswords = {
    'Ain shams': '754', 'Cairo_city_centr': '909', 'Giza': '1568',
    'Heliopolis': '2161', 'Maadi': '878', 'Mohandiseen': '1862',
    'Nasr city': '2851', 'October': '2161', 'Sheikh zayed': '854', 'T SOUTH': '1072'
};

// --- الدوال المساعدة (Helper Functions) ---

/**
 * دالة للاتصال بجوجل شيت مع دعم البيئة المحلية والاستضافة
 */
async function getDoc() {
    let credsData;
    
    // التحقق من وجود بيانات الاعتماد في متغيرات البيئة (للاستضافة أونلاين)
    if (process.env.GOOGLE_CREDS) {
        credsData = JSON.parse(process.env.GOOGLE_CREDS);
    } else {
        // التحقق من وجود الملف محلياً (للجهاز الشخصي)
        try {
            credsData = require('./credentials.json');
        } catch (e) {
            throw new Error("Missing credentials.json file or GOOGLE_CREDS environment variable.");
        }
    }

    const auth = new JWT({
        email: credsData.client_email,
        key: credsData.private_key.replace(/\\n/g, '\n'), // إصلاح مشكلة السطور الجديدة
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await doc.loadInfo();
    return doc;
}

/**
 * تنظيف البيانات وتحويلها لأرقام إذا لزم الأمر
 */
const cleanData = (val) => {
    if (!val || ['NA', '#N/A', 'N/A', ''].includes(val)) return 0;
    let res = parseFloat(val.toString().replace(/,/g, ''));
    return isNaN(res) ? val : res;
};

// --- المسارات (Routes) ---

// 1. صفحة تسجيل الدخول (عرض المناطق المتاحة تلقائياً)
app.get('/', async (req, res) => {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        // استخراج المناطق الفريدة من عمود zone_name
        const allZones = [...new Set(rows.map(r => r.get('zone_name')))].filter(z => z);
        res.render('login', { zones: allZones, error: null });
    } catch (e) { 
        console.error("Login Error:", e);
        res.status(500).send("خطأ في الاتصال بجوجل شيت: " + e.message); 
    }
});

// 2. معالجة بيانات الدخول
app.post('/login', (req, res) => {
    const { zone, password } = req.body;
    if (zonePasswords[zone] === password) {
        req.session.userZone = zone;
        res.redirect('/dashboard');
    } else {
        res.render('login', { zones: Object.keys(zonePasswords), error: 'كلمة المرور غير صحيحة' });
    }
});

// 3. لوحة التحكم الرئيسية (Dashboard)
app.get('/dashboard', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        let myRiders = rows.filter(r => r.get('zone_name') === req.session.userZone);

        // جلب بيانات التعيينات الجديدة
        const lastSheet = doc.sheetsByTitle['تعيينات الشهر'];
        const newRiderRows = await lastSheet.getRows();
        const newCount = newRiderRows.filter(r => r.get('zone_name') === req.session.userZone).length;

        const stats = {
            total: myRiders.length,
            withShifts: myRiders.filter(r => cleanData(r.get('شيفتات الغد')) > 0).length,
            noShifts: myRiders.filter(r => cleanData(r.get('شيفتات الغد')) === 0).length,
            highWallet: myRiders.filter(r => cleanData(r.get('المحفظه')) > 1000).length,
            newCount: newCount
        };
        res.render('dashboard', { riders: myRiders, zone: req.session.userZone, stats, headers: sheet.headerValues, cleanData });
    } catch (e) { 
        res.status(500).send("خطأ في تحميل البيانات من لوحة التحكم: " + e.message); 
    }
});

// 4. صفحة التعيينات الجديدة
app.get('/new-riders', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['تعيينات الشهر'];
        const rows = await sheet.getRows();
        const myNew = rows.filter(r => r.get('zone_name') === req.session.userZone);

        const stats = {
            total: myNew.length,
            received: myNew.filter(r => r.get('الحاله') === 'استلم').length,
            notReceived: myNew.filter(r => ['لم يستلم', 'لم يتم التسليم'].includes(r.get('الحاله'))).length
        };
        res.render('new_riders', { zone: req.session.userZone, riders: myNew, stats, headers: sheet.headerValues, cleanData });
    } catch (e) { 
        res.send("تأكد من وجود ورقة باسم 'تعيينات الشهر' في ملف جوجل شيت الخاص بك"); 
    }
});

// 5. صفحة التارجت والأداء
app.get('/targets', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['التارجت'];
        const rows = await sheet.getRows();
        const zoneData = rows.find(r => r.get('zone_name') === req.session.userZone);

        if (!zoneData) return res.send("لا توجد بيانات تارجت متاحة لهذه المنطقة حالياً");

        let performance = [];
        sheet.headerValues.forEach(h => {
            // تجميع الأعمدة التي تحتوي على تواريخ أداء
            if (h.includes('/')) performance.push({ date: h, value: cleanData(zoneData.get(h)) });
        });

        res.render('targets', { 
            zone: req.session.userZone, 
            performance, 
            target: cleanData(zoneData.get('normal Target')),
            avg: cleanData(zoneData.get('Average')),
            percent: zoneData.get('Average %') || '0%'
        });
    } catch (e) { 
        res.send("خطأ في الوصول لبيانات ورقة 'التارجت'"); 
    }
});

// 6. مسار تحميل بيانات المنطقة كملف Excel
app.get('/download', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const rows = await doc.sheetsByIndex[0].getRows();
        const myData = rows
            .filter(r => r.get('zone_name') === req.session.userZone)
            .map(r => r.toObject());

        const ws = XLSX.utils.json_to_sheet(myData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "RidersData");
        
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', `attachment; filename=Riders_${req.session.userZone}.xlsx`);
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (e) {
        console.error(e);
        res.status(500).send("حدث خطأ تقني أثناء محاولة تصدير ملف الإكسيل");
    }
});

// --- تشغيل السيرفر ---
const PORT = process.env.PORT || 3000;
// أضف هذا في أول الملف
const serverless = require('serverless-http');

// ... (باقي الكود الخاص بك) ...

// في آخر الملف استبدل الجزء القديم بهذا:
if (process.env.NETLIFY) {
  module.exports.handler = serverless(app);
} else {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}