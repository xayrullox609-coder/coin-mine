# Coin Mine Pro (Telegram Mini App) — GitHub va Render'da bepul

Tap o'yini: tanga bosish (x click energiyani ham x ga kamaytiradi), tanga do'koni (ketma-ket ochiladi),
olmos, boost, reyting, referal, vazifalar, olmos bilan kanal reklamasi, profil (kod, promokod, admin panel).

## Bepul stack
| Qism | Xizmat | Narx |
|---|---|---|
| Kod | GitHub | bepul |
| Server | Render (Free web service) | bepul |
| Baza | Neon (Postgres) | bepul |

> Nega Neon? Render'ning bepul serverida fayllar saqlanmaydi (har uyg'onish/deploy'da o'chadi), shuning uchun
> ma'lumotlar tashqi bepul bazada turadi.

## 1. Bot yaratish
@BotFather: `/newbot` -> **token** va **username** oling.

## 2. Bepul baza (Neon)
1. https://neon.tech ga kiring, yangi project yarating.
2. **Connection string** ni nusxalang (`postgresql://...neon.tech/neondb?sslmode=require`). Bu `DATABASE_URL`.
3. Jadvallarni qo'lda yaratish shart emas, server birinchi ishga tushganda o'zi yaratadi.

## 3. GitHub'ga yuklash
```bash
git init
git add .
git commit -m "Coin Mine Pro"
git branch -M main
git remote add origin https://github.com/SIZNING_NOM/coin-mine.git
git push -u origin main
```
`.env` GitHub'ga chiqmaydi (`.gitignore` da). `npm install` dan keyin `package-lock.json` ni ham commit qiling.

## 4. Render'da joylash (bepul)
1. https://render.com -> **New > Blueprint** -> GitHub repongizni tanlang (`render.yaml` o'qiladi, reja: `free`).
2. Quyidagi o'zgaruvchilarni kiriting:
   - `BOT_TOKEN` — BotFather tokeni
   - `BOT_USERNAME` — bot username'i (@ siz)
   - `DATABASE_URL` — Neon manzili
   - `CHANNEL` — vazifa kanali (@kanal), bot shu kanalda **admin** bo'lishi shart
   - `ADMIN_ID` — sizning Telegram ID'ingiz (admin panel va `/stats` uchun)
3. Deploy tugagach, botga `/start` yozing. `WEBAPP_URL` va webhook avtomatik o'rnatiladi.

### Bepul rejaning cheklovlari
- Render bepul servisi 15 daqiqa harakatsiz tursa uxlaydi, keyingi so'rov sekin (30–60 soniya) ochiladi.
  Kod o'zi har 10 daqiqada `/healthz` ga ping yuborib uyg'oq tutadi (o'chirish: `KEEP_ALIVE=false`).
  Ishonchli bo'lishi uchun https://uptimerobot.com orqali ham `https://SIZNING-SERVIS.onrender.com/healthz` ni 5 daqiqada tekshirtirib qo'ying.
- Bepul servis oyiga ~750 soat beradi: bitta servis uchun yetarli.
- Neon bepul rejasi kichik loyihalar uchun yetadi (hajm chegarasi bor).

## 5. Lokal ishga tushirish
```bash
npm install
cp .env.example .env     # to'ldiring (DATABASE_URL — Neon)
npm start
```
Lokalda HTTPS uchun `ngrok http 3000` va chiqqan manzilni `WEBAPP_URL` ga yozing.

## O'yin qoidalari
- **Tap**: har bosishda coin = tanganing "x" ko'paytirgichi, energiya ham shuncha kamayadi (x5 bo'lsa 5 energiya).
  Energiya = kunlik limit (500–1200), har kuni (UTC) yangilanadi.
- **Olmos**: do'kon uchun valyuta. Coinni olmosga aylantirib bo'lmaydi. Olmos Telegram Stars bilan sotib olinadi (tepadagi "+"), P2P bozorida olinadi yoki vazifa/reklamadan tushadi. Yangi foydalanuvchiga 100 olmos.
- **Do'kon**: 9 ta tanga, oldingisini olmasangiz keyingisi yopiq. **Boost**: 20 olmosga energiya to'ladi.
- **Vazifalar**: har birida "O'tish" (kanalga o'tadi) va "Tekshirish" (bot obunani tekshiradi) tugmalari.
- **Reklama ("+")**: kanal va obunachi soni kiritiladi, **1 obunachi = 2 olmos** to'lanadi, obunachi **1 olmos** oladi.
  Bot kanalda **admin** bo'lishi shart.
- **Profil**: 5 belgili kod (tahrirlanadi) orqali coin yuborish, promokod, admin panel (faqat `ADMIN_ID`).
- Sozlamalar (`SKINS`, `AD_COST` ...) `server.js` boshida; tanga ko'rinishi `public/index.html` dagi `SK` da, ikkalasi bir xil bo'lsin.

## Yangi: Boost xizmatlari, Stars to'lovi, profil
- **Boost bo'limi** (pastki menyuda birinchi): Instagram, Telegram, YouTube, PUBG Mobile va TikTok hozircha "Coming soon".
  Foydalanuvchi xizmat tanlaydi, havola/username/ID kiritadi, paket sonini yozadi va **olmos** bilan to'laydi.
  Narxlar `server.js` dagi `SERVICES` va `public/index.html` dagi `SV` da (ikkalasi bir xil bo'lsin).
- **Buyurtmalar qo'lda bajariladi**: buyurtma tushganda `ADMIN_ID` ga botdan xabar keladi, ostida **"Bajarildi"** va **"Rad etish"**
  tugmalari bor. Rad etilsa, olmos foydalanuvchiga avtomatik qaytariladi va unga xabar boradi. Xizmatni o'zingiz (yoki SMM provayder orqali) bajarasiz.
  `ADMIN_ID` kiritilmagan bo'lsa, buyurtmalar bazadagi `orders` jadvalida saqlanadi, lekin xabar kelmaydi.
- **Profil**: Kod, Promokod, **Coin va olmos sotib olish**, **Reyting**, **Do'stlar** (Admin panel faqat adminga).
- **Telegram Stars**: 1 Stars = 1000 coin yoki 20 olmos. Qo'shimcha sozlash kerak emas (BotFather'da to'lov ulash shart emas, valyuta XTR).
  To'lov tasdiqlangach bot balansni qo'shadi, bir to'lov ikki marta hisoblanmaydi (`payments` jadvali). Sinov saytida to'lov ishlamaydi.
- Tap sahifasidagi energiya tugmasi "BOOST" dan "ENERGIYA" ga o'zgartirildi (Boost endi xizmatlar bo'limi).

## Kod qoidalari va oynalar
- Birinchi kirishda har bir foydalanuvchiga **tasodifiy 5 belgili kod** beriladi. Uni **faqat 1 marta** o'zgartirish mumkin, keyin qulflanadi.
- **Har bir kod bir marta ishlatiladi**: kimdadir (yoki ilgari kimdadir) bo'lgan kodni boshqa hech kim ola olmaydi. Kodingizni `AAAAA` qilsangiz,
  boshqa odam `AAAAA` ni tanlay olmaydi, eski kodingiz ham boshqalarga berilmaydi (`codes_used` jadvali).
- Boost xizmatlari va profildagi tugmalar (Kod, Promokod, Sotib olish, Reyting, Do'stlar, Admin panel) **alohida oynada** ochiladi.

## Auksion
- Pastki menyu: **Boost, Vazifalar, Bosish, Auksion, Profil**.
- **Admin** (Profil, Admin panel, "Auksion: yangi buyum qo'shish"): rasm tanlaydi, nom va tavsif yozadi, **Joylash** bosadi.
  Rasm telefonda 800 px gacha kichraytirilib yuboriladi (server 600 KB gacha qabul qiladi) va bazada saqlanadi.
  Faol auksionlar ro'yxatida **Yakunlash** (g'olib: eng yuqori tikkan, unga bot xabar yuboradi) va **Bekor** (tikilgan coin qaytariladi) tugmalari bor.
- **Foydalanuvchi**: buyum ustiga bossa, alohida oynada rasm, tavsif, hozirgi tikilgan coin va **kimlar necha coin tikkani** ko'rinadi.
  Pastda coin miqdorini yozib **Tikish** bosadi. Tikish **oldingisidan ko'p** bo'lishi shart.
- **Coin ushlab turiladi**: tikilgan coin balansdan yechiladi, ustidan oshib ketilsa avtomatik qaytariladi (va botdan xabar boradi).
  O'zining tikishini oshirsa, faqat farqi yechiladi. Hammasi serverda, bitta tranzaksiyada tekshiriladi.
- Yakunlangan buyum qanday topshirilishini (masalan, g'olib bilan bog'lanish) o'zingiz hal qilasiz.

## Tanga rasmlari
- **1-4 daraja**: oddiy (oltin) tanga rasmi, **5-darajadan max darajagacha**: muzlik tangasi. Rasmlar yumaloq qilib kesilgan va `public/index.html` ichiga kiritilgan (alohida fayl kerak emas).
- Tap sahifasidagi katta tanga va do'kondagi kartochkalar shu rasmlardan foydalanadi, do'kon nomlari "LEVEL 1" dan "LEVEL 9" gacha.
- Rasmlarni almashtirish: yangi rasmni yumaloq (PNG yoki WebP) qilib, `index.html` dagi `.ci.g` va `.ci.i` qoidalaridagi base64 qiymatni almashtiring.
- **8-daraja**: muzlik tangasi "8" yozuvli rasm, **9-daraja** (max): olov tangasi "9" yozuvli rasm. 5-7 darajalar oddiy muzlik tangasi, 1-4 oltin.
- **Daraja rasmlari (yumaloq)**: 1-daraja oltin tanga, **2-6 darajalar** o'zlarining maxsus rasmlari (2: muzli tosh, 3: o'rmon, 4: yog'och, 5: kristall, 6: ko'k kristall), 7-daraja muzlik tangasi, 8-daraja muzlik "8", 9-daraja olov "9".
  Tap sahifasidagi tanga yorug'ligi (rangi) ham darajaga qarab o'zgaradi.

## P2P bozori (olmos oldi-sotdisi, Stars bilan)
Profil, **P2P bozori**:
- **Sotuvchi**: olmos sonini va necha Stars evaziga sotishini yozadi. **Olmos darhol yechiladi** (ushlab turiladi). Bekor qilsa, qaytadi. Bir vaqtda 5 tagacha taklif.
- **Xaridor**: ro'yxatda "N olmos" va "M Stars" tugmasini ko'radi (arzoni tepada). Stars tugmasi bosilsa, **Telegram to'lov oynasi o'zi ochiladi**.
  To'lov tasdiqlangach olmos avtomatik xaridorga o'tadi. To'lov paytida taklif 2 daqiqaga band qilinadi (ikki kishi bir olmosni sotib ololmaydi).
  Kutilmagan holatda Stars xaridorga avtomatik qaytariladi. Har bir to'lov faqat bir marta hisoblanadi.
- **Muhim cheklov**: Telegram botga Stars'ni boshqa foydalanuvchiga o'tkazishga ruxsat bermaydi, Stars hamisha bot egasiga tushadi.
  Shuning uchun sotuvchi daromadi ilovadagi **Stars hamyon**ga yoziladi. Yechish: "Stars yechish" (kamida 50 Stars), to'lov ma'lumoti yoziladi,
  adminga botdan xabar keladi ("To'landi" va "Rad etish" tugmalari, rad etilsa Stars hamyonga qaytadi). Pulni sotuvchiga o'zingiz (karta va hokazo) to'laysiz.
- **Komissiya**: `P2P_FEE` o'zgaruvchisi (foiz), standart `0`. Masalan `P2P_FEE=5` bo'lsa, sotuvchiga 95% yoziladi.
- Diqqat: Stars bilan ichki valyuta oldi-sotdisi va naqd pul to'lash Telegram qoidalariga zid bo'lishi mumkin. Ishga tushirishdan oldin Telegram shartlarini tekshiring.

## Yuqoridagi tanga
Tepadagi panelda va balans yonidagi tanga endi o'rtadagi tanganing (tanlangan daraja) rasmi bilan bir xil.

## Auksion muddati
- Admin auksion qo'shayotganda **"Auksion necha soat davom etadi"** (1 dan 720 soatgacha) maydonini to'ldiradi.
- Foydalanuvchilarda ro'yxatda va auksion oynasida **qolgan vaqt** ko'rinib turadi (kun, soat, daqiqa).
- Muddat tugagach auksion **o'zi yakunlanadi** (server har daqiqada tekshiradi): g'olib eng yuqori tikkan, unga va adminga botdan xabar boradi, tikish yopiladi.
  Admin xohlasa, muddatdan oldin "Yakunlash" yoki "Bekor" qilishi mumkin.

## Sonlar
Balans va narxlar qisqartirilmay, aniq ko'rsatiladi (masalan 16 400). Ajratgichni `public/index.html` dagi `SEP` o'zgaruvchisida almashtirish mumkin (masalan `const SEP='.'` bo'lsa 16.400).

## P2P bozori: ko'rinishi
- P2P bozorida **boshqa odamlar sotuvga qo'ygan olmoslar** ro'yxat bo'lib ko'rinadi: olmos soni, sotuvchi ismi, "1 Stars = N olmos" kursi va Stars narxi tugmasi (arzoni tepada).
- O'zingiz olmos qo'yish uchun pastki o'ng burchakdagi **ko'k yumaloq "+" tugmasi** (oq plyus) bosiladi, alohida oyna ochiladi: olmos soni va Stars narxi. Qo'yilgach bozorga qaytadi.
- P2P bozori **to'liq ekran** bo'lib ochiladi (tepada orqaga tugmasi va olmos balansi bor). "Mening takliflarim" bo'limi olib tashlangan.
  Eslatma: server bekor qilishni qo'llab-quvvatlaydi (`p2p_cancel`), lekin hozir ilovada bekor qilish tugmasi yo'q, shuning uchun qo'yilgan olmos sotilmaguncha band turadi.

## P2P: o'z takliflari va Stars yechish
- Foydalanuvchining o'zi qo'ygan olmoslar bozor ro'yxatida **o'ziga ham ko'rinadi** (yashil fon, "Sizniki" belgisi, ro'yxatning tepasida). O'zining taklifida Stars tugmasi o'rniga **"Bekor"** tugmasi turadi, bosilsa olmos qaytariladi.
- **Stars yechishda** faqat **Telegram username (@username) yoki raqamli ID** so'raladi (karta va telefon raqami so'ralmaydi, server ham boshqa ma'lumotni qabul qilmaydi). Maydon foydalanuvchining username'i yoki ID'si bilan o'zi to'ldiriladi.

## Yangiliklar: auksion bo'limlari, P2P olmos va tanga, Boost belgilari
- **Auksion**: tepada **Faol | Tugagan** tugmalari. Faol: davom etayotganlar, Tugagan: yakunlangan va bekor qilinganlar (muddati o'tganlar ham).
- **P2P bozori**: tepada **OLMOS | TANGA** bo'limlari. Odamlar olmos ham, tanga (coin) ham sotuvga qo'yadi (olmos kamida 10, tanga kamida 1 000, narx 1-5000 Stars).
  Qo'yilgan olmos/tanga hammaga ko'rinadi (ro'yxat 10 soniyada o'zi yangilanadi), o'zingiznikida "Sizniki" va "Bekor" tugmasi bor.
  Sotilsa tanga/olmos xaridorga o'tadi, Stars sotuvchining Stars hamyoniga yoziladi.
- **Boost**: har bir platforma o'z belgisi bilan (Telegram, Instagram, YouTube, PUBG Mobile, TikTok). Belgilar kod ichida SVG qilib chizilgan (rasmiy rasm emas).
  Rasmiy rasm kerak bo'lsa, rasm yuborsangiz `platIcon` funksiyasidagi belgini almashtiramiz.
- **Boost miqdori**: endi haqiqiy miqdor kiritiladi (masalan 1000 ta ko'rish), narx proporsional hisoblanadi (1000 ta = 20 olmos bo'lsa, 2000 ta = 40 olmos).
  Miqdor paket hajmining ko'paytmasi bo'ladi, eng ko'pi 100 paket. Serverda ham tekshiriladi.

## Promokod: kanal posti, limit, o'chirish va auksion e'lonlari
- **Promokod qo'shganda** bot kanalga (`CHANNEL`) post yuboradi: **yashil rasm**, rasm ichida **promokod yozilgan** (rasmni admin brauzeri chizadi), tagida
  "🎁 +N 🪙", holat ("🟢 FAOL" yoki "🔴 TUGAGAN") va limit ("👥 Limit: N kishi. Qoldi: M" yoki "♾ Limit cheksiz").
  Har safar kimdir ishlatsa, post yangilanadi (qolgan limit kamayadi, tugasa "TUGAGAN" bo'ladi).
- **Limit**: bo'sh qoldirilsa, promokod **cheksiz** ishlatiladi.
- **Promokodni o'chirish**: Admin panelda promokodlar ro'yxatida har birining yonida "O'chirish" tugmasi bor. O'chirilsa, kanaldagi post ham o'chadi.
- **Auksion g'olibi**: auksion tugaganda (muddat o'tganda yoki admin yakunlaganda) bot kanalga "@username «buyum» ni yutdi" deb yozadi (buyum rasmi bo'lsa, rasm bilan).
  Username yo'q bo'lsa, ismi havola bo'lib chiqadi.
- **Muhim**: bot `CHANNEL` kanalida **admin** va **xabar yuborish huquqiga ega** bo'lishi shart, aks holda postlar yuborilmaydi (logda xato chiqadi).

## Coming soon
**PUBG Mobile** va **TikTok** xizmatlari hozircha "Coming soon" ko'rinishida (xira, bosilmaydi). Server ham PUBG buyurtmasini qabul qilmaydi.
Yoqish uchun: `public/index.html` dagi `SV` ro'yxatida `off:true` ni olib tashlang va `server.js` dagi `SERVICES.pubg_uc` dan `soon: true` ni o'chiring.

## Reyting: TANGA | OLMOS | REFERAL
- Profil, Reyting: tepada uchta bo'lim, har birida **top 10** va foydalanuvchining o'z o'rni.
- **Tanga** va **olmos** reytingi doimiy (hech qachon nolga qaytmaydi).
- **Referal** reytingi **har 30 kunda 0 ga qaytadi** (hamma uchun bir vaqtda; 2025-yil 1-yanvardan 30 kunlik davrlar). Ekranda yangilanishgacha qolgan vaqt ko'rinadi.
  Davr ichidagi takliflar `referrals` jadvalidagi sanalar bo'yicha hisoblanadi. Eski (bu yangilanishdan oldingi) takliflar sanasi saqlanmagani uchun referal reytingi nol bilan boshlanadi.
  Umumiy taklif qilinganlar soni ("Do'stlar" bo'limida) o'zgarmaydi va nolga qaytmaydi.

## Mening buyurtmalarim
Boost sahifasidagi ro'yxat olib tashlandi. Endi **Profil** bo'limining eng oxirida "Mening buyurtmalarim" tugmasi bor, bossa alohida oyna ochiladi: har bir buyurtmada xizmat belgisi, nomi va miqdori, sanasi, olmos narxi va holati (Kutilmoqda, Bajarildi, Rad etildi). Oxirgi 30 ta buyurtma ko'rinadi.

## Vazifalar: admin qo'shadigan vazifalar
- Eski tizim vazifalari ("Kanalga obuna bo'ling", "3 ta do'st taklif qiling", "Do'konda 3 ta tanga oling") **olib tashlandi**.
- **Admin panel, "Vazifa qo'shish"**: tur tanlanadi: **Kanal | Bot | Reklama video | Sayt havolasi**. Nomi, havola, mukofot (coin yoki olmos), ixtiyoriy kutish vaqti va limit (bo'sh = cheksiz) yoziladi. Qo'shilgan vazifa hamma foydalanuvchining Vazifalar bo'limida paydo bo'ladi. Admin ro'yxatdan "O'chirish" mumkin.
- Foydalanuvchida har vazifada **"O'tish"** (havolani ochadi) va **"Tekshirish"** (mukofotni beradi) tugmalari bor. Har kim har vazifani faqat bir marta bajaradi.
- **Tekshiruv turlari**: **Kanal** vazifasi serverda Telegram orqali **haqiqatan tekshiriladi** (bot o'sha kanalda admin bo'lishi shart, qo'shishda tekshiriladi).
  **Bot, Reklama video va Sayt** vazifalarini Telegram tekshira olmaydi, shuning uchun ular **vaqt bo'yicha** ishlaydi: "O'tish" bosilgach admin belgilagan soniya (standart: bot va sayt 10, video 30) o'tmaguncha mukofot berilmaydi. Bu odam haqiqatan bajarganini isbotlamaydi.
- Foydalanuvchilar o'z kanalini olmos bilan reklama qilish ("+" tugmasi) avvalgidek ishlaydi.

## Promokod kanalga kelmasa
- Kanal manzili `CHANNEL` o'zgaruvchisidan olinadi (Render, Environment). **Bo'sh bo'lsa, `@coinminer_team` ishlatiladi.** `kanal`, `@kanal` yoki `https://t.me/kanal` deb yozilsa ham to'g'ri o'qiladi.
- Bot kanalda **admin** bo'lishi va **"Xabarlarni yuborish"** huquqiga ega bo'lishi shart (rasm yuborish uchun ham).
- Promokod qo'shilganda **natija adminga ko'rsatiladi**: kanalga yuborilgan bo'lsa "Promokod qo'shildi va kanalga yuborildi", yuborilmagan bo'lsa sababi bilan ogohlantirish chiqadi (kanal topilmadi yoki bot huquqi yo'q).
- Admin panelda promokodlar ro'yxati ostida **"Kanal ulanishini tekshirish"** tugmasi bor: kanalga hech narsa yubormasdan botning kanaldagi holatini va huquqini tekshiradi.

## "socket hang up" xatosi (promokod rasmi kanalga bormaganda)
- Sabab: Node 19+ da Telegram'ga ochiq turgan eski ulanish qayta ishlatilib, rasm yuklash paytida uzilib qolardi. Endi Telegram so'rovlari yangi ulanish bilan (keep-alive o'chiq) yuboriladi va tarmoq xatosida **3 martagacha qayta uriniladi**.
- Promokod posti endi 3 bosqichda yuboriladi: 1) rasm **havola orqali** (Telegram rasmni o'zi bizning serverdan oladi), 2) rasmni **to'g'ridan-to'g'ri yuklash**, 3) bo'lmasa **matn** (promokod matnda yoziladi). Shuning uchun post har holda kanalga chiqadi.
- Xato xabarlarida bot tokeni yashiriladi.

## /start xabari: rasm bilan
- `/start` bosilganda bot **rasm** (`public/start.jpg`) yuboradi, rasm ostida iqtibosli (blockquote) matn va **"O'ynash"** tugmasi turadi.
- Rasm 3 bosqichda yuboriladi: 1) havola orqali (`https://SIZNING-SERVIS/start.jpg`, Telegram o'zi oladi), 2) to'g'ridan-to'g'ri yuklash, 3) bo'lmasa faqat matn. Birinchi muvaffaqiyatli yuborishdan keyin Telegram `file_id` si eslab qolinadi va keyingi `/start` lar tezroq ishlaydi.
- Rasmni almashtirish uchun `public/start.jpg` faylini boshqasiga almashtiring (nomi o'zgarmasin). Matnni o'zgartirish: `server.js` dagi `START_TEXT`. Rasm tagidagi matn 1024 belgidan oshmasligi kerak.

## Vazifalar: yangi ko'rinish
- Har bir vazifa bir qatorli kartochka: **belgi | nomi va izoh (masalan "Kanal · 12/100") | mukofot (ramkali yashil belgi) | bitta tugma**.
- Tugma avval **"Bajarish"** (video uchun **"Ko'rish"**). Bosilsa, kanal, bot, reklama yoki saytga o'tadi. Mini App'ga qaytganda tugma **"Tekshirish"** (yashil) bo'lib turadi.
  Bot, video va sayt vazifalarida belgilangan vaqt o'tmaguncha tugma **"Kuting 10s"** ko'rinishida (bosilmaydi), vaqt tugagach "Tekshirish" bo'ladi.
- Ilova yopilib qayta ochilsa ham, boshlangan vazifa "Tekshirish" holatida qoladi (server eslab qoladi). Foydalanuvchilar qo'ygan kanal reklamalari ham shu ko'rinishda.
