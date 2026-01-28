const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const session = require('express-session');
const XLSX = require('xlsx');
const path = require('path');

const app = express();

// إعدادات المحرك والقوالب
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// إعدادات الجلسة (Session)
app.use(session({
    secret: 'talabat-supervisor-pro-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, secure: false }
}));

const SPREADSHEET_ID = '1bNhlUVWnt43Pq1hqDALXbfGDVazD7VhaeKM58hBTsN0';

const zonePasswords = {
    'Ain shams': '754', 'Alexandria': '1234', 'Cairo_city_centr': '909', 
    'Giza': '1568', 'Heliopolis': '2161', 'Ismalia city': '1122', 
    'Kafr el-sheikh': '3344', 'Maadi': '878', 'Mansoura': '5566', 
    'Mohandiseen': '1862', 'Nasr city': '2851', 'New damietta': '7788', 
    'October': '2161', 'Portsaid city': '9900', 'Shebin el koom': '4455', 
    'Sheikh zayed': '854', 'Suez': '6677', 'Tagammoa south': '1072', 
    'Tanta': '8899', 'Zagazig': '2233'
};

// دالة تنظيف البيانات
const cleanData = (val) => {
    if (val === undefined || val === null || ['NA', '#N/A', 'N/A', '', 'null'].includes(val)) return 0;
    let res = parseFloat(val.toString().replace(/,/g, ''));
    return isNaN(res) ? val : res;
};

// دالة الاتصال بجوجل شيت (معدلة للعمل مع Railway)
async function getDoc() {
    try {
        const keysData = process.env.googe143;
        if (!keysData) {
            throw new Error("Variable 'googe143' not found in Railway Settings");
        }

        const credsData = JSON.parse(keysData);
        
        const auth = new JWT({
            email: credsData.client_email,
            key: credsData.private_key.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
        await doc.loadInfo();
        return doc;
    } catch (err) {
        console.error("❌ Google API Error:", err.message);
        throw err;
    }
}

// --- المسارات (Routes) ---

// 1. صفحة الدخول
app.get('/', async (req, res) => {
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        // جلب أسماء المناطق الفريدة من الشيت
        const allZones = [...new Set(rows.map(r => r.get('zone_name')))].filter(z => z);
        res.render('login', { zones: allZones, error: null });
    } catch (e) { 
        res.status(500).send("خطأ في الاتصال بالسيرفر: " + e.message); 
    }
});

// 2. معالجة الدخول
app.post('/login', (req, res) => {
    const { zone, password } = req.body;
    if (zonePasswords[zone] === password) {
        req.session.userZone = zone;
        res.redirect('/dashboard');
    } else {
        // إعادة تحميل الصفحة مع الخطأ
        res.render('login', { zones: Object.keys(zonePasswords), error: 'كلمة المرور غير صحيحة' });
    }
});

// 3. لوحة التحكم الرئيسية
app.get('/dashboard', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        let myRiders = rows.filter(r => r.get('zone_name') === req.session.userZone);

        const stats = {
            total: myRiders.length,
            withShifts: myRiders.filter(r => cleanData(r.get('شيفتات الغد')) > 0).length,
            noShifts: myRiders.filter(r => cleanData(r.get('شيفتات الغد')) === 0).length,
            highWallet: myRiders.filter(r => cleanData(r.get('المحفظه')) > 1000).length
        };
        res.render('dashboard', { riders: myRiders, zone: req.session.userZone, stats, headers: sheet.headerValues, cleanData });
    } catch (e) { res.status(500).send("خطأ: " + e.message); }
});

// 4. صفحة تحليل التارجت
app.get('/targets', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['التارجت'];
        const rows = await sheet.getRows();
        const zoneData = rows.find(r => r.get('zone_name') === req.session.userZone);

        res.render('targets', { zone: req.session.userZone, zoneData, cleanData });
    } catch (e) { res.send("تأكد من وجود شيت باسم 'التارجت' في الملف"); }
});

// 5. صفحة التعيينات الجديدة
app.get('/new-riders', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const sheet = doc.sheetsByTitle['تعيينات الشهر'];
        const rows = await sheet.getRows();
        const myRiders = rows.filter(r => r.get('zone_name') === req.session.userZone);
        
        const stats = {
            total: myRiders.length,
            received: myRiders.filter(r => r.get('الحاله') === 'استلم').length,
            notReceived: myRiders.filter(r => r.get('الحاله') !== 'استلم').length
        };
        res.render('new_riders', { riders: myRiders, zone: req.session.userZone, stats, headers: sheet.headerValues, cleanData });
    } catch (e) { res.send("تأكد من وجود شيت باسم 'تعيينات الشهر'"); }
});

// 6. تحميل ملف إكسيل للزون
app.get('/download', async (req, res) => {
    if (!req.session.userZone) return res.redirect('/');
    try {
        const doc = await getDoc();
        const rows = await doc.sheetsByIndex[0].getRows();
        const myData = rows.filter(r => r.get('zone_name') === req.session.userZone).map(r => r.toObject());
        const ws = XLSX.utils.json_to_sheet(myData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Data");
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', `attachment; filename=${req.session.userZone}_Data.xlsx`);
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
    } catch (e) { res.status(500).send("خطأ في التصدير"); }
});

// خروج
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000; 
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر شغال بنجاح على بورت ${PORT}`);
});