const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const db = new Database("C:/Users/HP/source/repos/claude-kanban/kanban.db");

// Create workflow
const WORKFLOW_ID = randomUUID();
const STEP1_ID = randomUUID();
const STEP2_ID = randomUUID();
const STEP3_ID = randomUUID();

db.prepare("INSERT INTO workflows (id, project_id, title, description, status, shared_memory, plan) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
  WORKFLOW_ID,
  "55cf8752-db98-4fb8-a383-0d29b9f252dc",
  "Teklif Modulu - Ozel Alan ve Esnek Sablon Destegi",
  "Bid modulune teklife ozel ek alanlar, verilecek hizmetler listesi ve esnek PDF sablonu destegi ekle",
  "draft",
  "{}",
  "{}"
);

// Step 1: Entity ve Migration guncellemesi
const step1Prompt = `Karbon projesinde Bid (teklif) modulunu guncelle. Migration'da zaten var ama entity'de eksik olan alanlari ekle ve yeni "custom fields" destegi getir.

MEVCUT DURUM:
- Data/Entities/Bid/Bid.cs entity'sinde migration'da olan su alanlar EKSIK:
  PdfFilePath, PdfGeneratedAt, CoverLetterText, FooterText, GeneralTermsText, HeaderTitle, RecipientName, RecipientTitle, ServicesDescription, PricesIncludeKdv
- BidSettings DbSet ApplicationDbContext'te yok olabilir

YAPILACAKLAR:

1. Bid.cs entity'sine eksik alanlari ekle:
   - string? PdfFilePath
   - DateTime? PdfGeneratedAt
   - string? CoverLetterText (varsayilan ust yazi)
   - string? FooterText (alt bilgi)
   - string? GeneralTermsText (genel sartlar)
   - string? HeaderTitle (header basligi)
   - string? RecipientName (alici adi)
   - string? RecipientTitle (alici unvani)
   - string? ServicesDescription (verilecek hizmetler aciklamasi)
   - bool PricesIncludeKdv (fiyatlara KDV dahil mi)

2. Bid.cs entity'sine YENi "CustomSections" destegi ekle:
   - string? CustomSectionsJson — JSON formatinda ek bolumleri saklar
   Ornek JSON:
   [
     {
       "title": "Fiyat Hesaplama Detayi",
       "content": "Aylik asgari fiyat; sozlesmelerin imzalandigi tarihte gecerli olan...",
       "position": "after_services",
       "order": 1
     },
     {
       "title": "Verilecek Hizmetler",
       "content": "1. Duzenli aylik firma ziyareti\\n2. Resmi evraklarin takibi\\n3. ...",
       "position": "after_price",
       "order": 2
     }
   ]
   Position degerleri: "before_services", "after_services", "after_price", "before_terms", "after_terms"

3. BidItem.cs entity'sine ek alanlar:
   - string? DetailedDescription — Uzun aciklama metni (asigari ucret hesaplama formulu gibi)

4. CreateBidRequest ve UpdateBidRequest DTO'larina ekle:
   - string? CoverLetterText
   - string? GeneralTermsText
   - string? HeaderTitle
   - string? ServicesDescription
   - string? CustomSectionsJson
   - Her BidItem'a: string? DetailedDescription

5. BidDetailDto response'una ekle:
   - CoverLetterText, GeneralTermsText, HeaderTitle, ServicesDescription, CustomSectionsJson
   - Her BidItemDto'ya: DetailedDescription

6. BidManagementService'de teklif olusturma/guncelleme metodlarini guncelle:
   - Yeni alanlar DB'ye kaydedilsin
   - Teklif olusturulurken BidSettings'ten varsayilan degerler kopyalansin (CoverLetterText, GeneralTermsText, HeaderTitle, FooterText)
   - Kullanici bunlari override edebilsin

7. Migration olustur: dotnet ef migrations add AddCustomFieldsToBid
   DIKKAT: Sadece entity'de yeni olan ve migration'da olmayan alanlar icin migration gerekir.
   Eger tum alanlar zaten migration'da varsa, migration bostur - sorun degil.

8. dotnet build ile kontrol et, HATA VARSA DUZELT

ONEMLI:
- Mevcut calisan GET/POST/PUT/DELETE endpoint'lerine zarar verme
- Yeni alanlar nullable olsun (geriye donuk uyumluluk)
- BaseResponseModel pattern'ini kullan
- Turkce response mesajlari kullan`;

// Step 2: BidSettings endpoint'leri (CRUD yoksa ekle)
const step2Prompt = `Karbon projesinde BidSettings icin CRUD endpoint'lerini kontrol et ve eksikleri tamamla.

Oncelikle BidManagementController.cs ve BidManagementService.cs dosyalarini oku.

KONTROL ET:
1. BidSettings icin GET/POST/PUT endpoint'leri var mi?
2. ApplicationDbContext'te DbSet<BidSettings> var mi?

YOKSA EKLE:
1. GET /api/bid/settings — Firmanin mevcut BidSettings'ini getir (yoksa default degerlerle don)
2. PUT /api/bid/settings — BidSettings'i guncelle veya olustur (upsert mantigi)
   Request: BankName, BankBranch, IBAN, StampImagePath, DocumentNo, RevisionNo, CoverLetterText, GeneralTermsText, FooterText, HeaderTitle
3. POST /api/bid/settings/stamp — Kase/muhur gorseli yukle (multipart/form-data) — S3'e yukle

BidSettings CRUD'u IBidManagementService ve BidManagementService icine ekle.
Ayri controller OLUSTURMA, mevcut BidManagementController icine ekle.

Ayrica teklif olusturma endpoint'inde (POST /api/bid/bids) su mantigi ekle:
- Eger CoverLetterText, GeneralTermsText, HeaderTitle bos gelirse, BidSettings'ten varsayilan degerleri kopyala
- Kullanici bunlari doldurursa, kullanicinin degerleri kullanilsin

dotnet build ile kontrol et, HATA VARSA DUZELT`;

// Step 3: Frontend dokumantas yonu
const step3Prompt = `Backend'e eklenen teklif ozel alan ve esnek sablon ozelliklerini anlatan frontend dokumantasyonu hazirla.

ONEMLI: KOD YAZMA! Sadece dokuman uret.

Dokumani C:/Users/HP/source/repos/Karbon/docs/FRONTEND-BID-CUSTOM-FIELDS.md olarak yaz.

Backend'deki degisiklikleri incele:
- Bid.cs entity'sindeki yeni alanlar
- BidManagementController.cs deki guncellenmis endpoint'ler
- Request/Response DTO'larindaki yeni alanlar
- BidSettings endpoint'leri

Dokumanda sunlar olmali:

1. DEGISIKLIK OZETI
   - Mevcut vs yeni karsilastirma tablosu
   - Yeni alanlar listesi

2. TEKLIF OLUSTURMA/DUZENLEME FORMU DEGISIKLIKLERI
   - CoverLetterText — Zengin metin editoru (varsayilan BidSettings'ten gelir, override edilebilir)
   - GeneralTermsText — Zengin metin editoru
   - HeaderTitle — Text input
   - ServicesDescription — "Verilecek Hizmetler" listesi editoru
   - BidItem.DetailedDescription — Her kalem icin uzun aciklama alani

3. OZEL BOLUMLER (CustomSections)
   - Dinamik form: Bolum ekle/cikar
   - Her bolum: title, content, position (dropdown), order
   - Position secenekleri ve anlami
   - JSON formati

4. BIDSETTINGS YONETIM SAYFASI
   - GET /api/bid/settings endpoint'i
   - PUT /api/bid/settings endpoint'i
   - Kase/muhur yuklemesi
   - Varsayilan degerler formu

5. PDF ONIZLEME MANTIGI
   - Teklif PDF'inin sayfa yapisi (3 sayfa)
   - Sayfa 1: Kapak (Header + Firma bilgileri + Ust yazi)
   - Sayfa 2: Hizmetler tablosu + Fiyat + Verilecek Hizmetler + Custom Sections
   - Sayfa 3: Genel Sartlar + Banka + Kase
   - Custom section'larin nereye yerlesecegi

6. API ENDPOINT DETAYLARI
   - Her endpoint icin URL, method, request/response ornekleri
   - Hata durumlari

7. TYPESCRIPT TYPE TANIMLARI
   - Tum yeni interface'ler

8. ORNEK PDF KARSILASTIRMASI
   - Verilen ornek PDF'deki alanlar vs sistem alanlar
   - Eksik alanlarin nasil CustomSections ile karsilanacagi`;

// Insert steps
db.prepare("INSERT INTO workflow_steps (id, workflow_id, role, title, prompt, depends_on, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
  STEP1_ID, WORKFLOW_ID, "backend", "Bid Entity ve Custom Fields Guncelleme", step1Prompt, "[]", 0
);

db.prepare("INSERT INTO workflow_steps (id, workflow_id, role, title, prompt, depends_on, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
  STEP2_ID, WORKFLOW_ID, "backend", "BidSettings CRUD ve Varsayilan Deger Mantigi", step2Prompt, JSON.stringify([STEP1_ID]), 1
);

db.prepare("INSERT INTO workflow_steps (id, workflow_id, role, title, prompt, depends_on, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
  STEP3_ID, WORKFLOW_ID, "frontend-doc", "Frontend Dokumantasyonu - Esnek Teklif Sablonu", step3Prompt, JSON.stringify([STEP2_ID]), 2
);

console.log("Workflow created:", WORKFLOW_ID);
console.log("Steps:");
console.log("  Step 1 (backend - entity):", STEP1_ID);
console.log("  Step 2 (backend - settings):", STEP2_ID, "depends_on:", STEP1_ID);
console.log("  Step 3 (frontend-doc):", STEP3_ID, "depends_on:", STEP2_ID);
db.close();
