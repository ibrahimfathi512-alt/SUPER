const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const session = require('express-session');
const XLSX = require('xlsx');
const path = require('path'); // مضاف لضمان المسارات

const app = express();

// إعدادات المحرك (Views)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'))); // لتشغيل ملفات CSS/Images مستقبلاً

app.use(express.urlencoded({ extended: true }));

// إعداد السيسشن - ملاحظة: Render يستخدم HTTP لذا secure: false مناسبة للخطة المجانية
app.use(session({
    secret: process.env.SESSION_SECRET || 'talabat-final-pro-2026',
    resave: false,
    saveUninitialized: false, // تم تغييرها لـ false لخصوصية أفضل
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // تنتهي الجلسة بعد يوم
        secure: false 
    } 
}));

const SPREADSHEET_ID = '1bNhlUVWnt43Pq1hqDALXbfGDVazD7VhaeKM58hBTsN0';

const zonePasswords = {
    'Ain shams': '754', 'Cairo_city_centr': '909', 'Giza': '1568',
    'Heliopolis': '2161', 'Maadi': '878', 'Mohandiseen': '1862',
    'Nasr city': '2851', 'October': '2161', 'Sheikh zayed': '854', 'T SOUTH': '1072'
};

// --- الدالة المحدثة للاتصال بجوجل ---
async function getDoc() {
    let credsData;
    
    if (process.env.GOOGLE_CREDS) {
        try {
            // تحويل النص من متغيرات البيئة إلى Object
            credsData = JSON.parse(process.env.GOOGLE_CREDS);
        } catch (e) {
            throw new Error("خطأ في قراءة متغير البيئة GOOGLE_CREDS. تأكد من أنه JSON صحيح.");
        }
    } else {
        try {
            credsData = require('./credentials.json');
        } catch (e) {
            throw new Error("ملف credentials.json غير موجود محلياً.");
        }
    }

    const auth = new JWT({
        email: credsData.client_email,
        key: credsData.private_key.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await doc.loadInfo();
    return doc;
}

const cleanData = (val) => {
    if (val === undefined || val === null || ['NA', '#N/A', 'N/A', ''].includes(val)) return 0;
    let res = parseFloat(val.toString().replace(/,/g, ''));
    return isNaN(res) ? val : res;
};

// --- المسارات (Routes) ---

app.get('/', async (req, res) => {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        const allZones = [...new Set(rows.map(r => r.get('zone_name')))].filter(z => z);
        res.render('login', { zones: allZones, error: null });
    } catch (e) { 
        console.error("Login Error:", e);
        res.status(500).send("خطأ في الاتصال: " + e.message); 
    }
});

app.post('/login', (req, res) => {
    const { zone, password } = req.body;
    if (zonePasswords[zone] === password) {
        req.session.userZone = zone;
        res.redirect('/dashboard');
    } else {
        // إعادة جلب المناطق في حالة الخطأ
        res.render('login', { zones: Object.keys(zonePasswords), error: 'كلمة المرور غير صحيحة' });
    }
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        let myRiders = rows.filter(r => r.get('zone_name') === req.session.userZone);

        const lastSheet = doc.sheetsByTitle['تعيينات الشهر'];
        let newCount = 0;
        if (lastSheet) {
            const newRiderRows = await lastSheet.getRows();
            newCount = newRiderRows.filter(r => r.get('zone_name') === req.session.userZone).length;
        }

        const stats = {
            total: myRiders.length,
            withShifts: myRiders.filter(r => cleanData(r.get('شيفتات الغد')) > 0).length,
            noShifts: myRiders.filter(r => cleanData(r.get('شيفتات الغد')) === 0).length,
            highWallet: myRiders.filter(r => cleanData(r.get('المحفظه')) > 1000).length,
            newCount: newCount
        };
        res.render('dashboard', { riders: myRiders, zone: req.session.userZone, stats, headers: sheet.headerValues, cleanData });
    } catch (e) { 
        res.status(500).send("خطأ في التحميل: " + e.message); 
    }
});

// صفحة التعيينات والتارجت (تم الإبقاء عليها كما هي)
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
    } catch (e) { res.send("تأكد من وجود ورقة 'تعيينات الشهر'"); }
});

app.get('/targets', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['التارجت'];
        const rows = await sheet.getRows();
        const zoneData = rows.find(r => r.get('zone_name') === req.session.userZone);
        if (!zoneData) return res.send("لا توجد بيانات تارجت لهذه المنطقة");

        let performance = [];
        sheet.headerValues.forEach(h => {
            if (h.includes('/')) performance.push({ date: h, value: cleanData(zoneData.get(h)) });
        });

        res.render('targets', { 
            zone: req.session.userZone, 
            performance, 
            target: cleanData(zoneData.get('normal Target')),
            avg: cleanData(zoneData.get('Average')),
            percent: zoneData.get('Average %') || '0%'
        });
    } catch (e) { res.send("خطأ في ورقة 'التارجت'"); }
});

app.get('/download', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const rows = await doc.sheetsByIndex[0].getRows();
        const myData = rows.filter(r => r.get('zone_name') === req.session.userZone).map(r => r.toObject());
        const ws = XLSX.utils.json_to_sheet(myData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "RidersData");
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', `attachment; filename=Riders_${req.session.userZone}.xlsx`);
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (e) { res.status(500).send("خطأ في التصدير"); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server ready on port ${PORT}`));