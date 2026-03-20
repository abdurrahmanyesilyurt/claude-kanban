const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const db = new Database("C:/Users/HP/source/repos/claude-kanban/kanban.db");

const WORKFLOW_ID = "7619d169-0e67-4ca2-b3ce-2f1d40ef5713";
const STEP1_ID = randomUUID();
const STEP2_ID = randomUUID();

const step1Prompt = `NaceCode entity icin CRUD (Create, Update, Delete) endpoint'leri ekle. MEVCUT GET ENDPOINT'LERINE DOKUNMA!

Mevcut dosyalar:
- Controllers/NaceCodeController.cs (sadece GET var, POST/PUT/DELETE ekle)
- Services/NaceCodeService.cs (sadece okuma metotlari var, yazma metotlari ekle)
- Services/Interfaces/INaceCodeService.cs (yeni metot imzalari ekle)
- Data/Entities/NaceCode.cs (entity zaten var, degistirme)

EKLENECEK ENDPOINT'LER:

1. POST /api/nace-codes - Yeni NACE kodu ekle
   Request: { code, description, dangerClass?, parentCode?, level }
   Validasyonlar:
   - Code benzersiz olmali (ayni code varsa 409 Conflict)
   - ParentCode verilmisse parent var mi kontrol et
   - Level 1-5 arasi olmali
   - Code ve Description zorunlu

2. PUT /api/nace-codes/{id} - NACE kodunu guncelle
   Request: { code?, description?, dangerClass?, parentCode?, level? }
   Validasyonlar:
   - ID'ye sahip kayit yoksa 404
   - Code degistiriliyorsa benzersizlik kontrol et
   - ParentCode degistiriliyorsa parent var mi kontrol et

3. DELETE /api/nace-codes/{id} - NACE kodunu sil
   Validasyonlar:
   - ID'ye sahip kayit yoksa 404
   - Alt kategorileri (children) varsa silme, hata don (bu kodu kullanan alt kodlar var)
   - Bu kod bir firmaya atanmissa uyari don ama yine de silebilsin (query param: ?force=true)

4. POST /api/nace-codes/bulk - Toplu NACE kodu ekle
   Request: Array of { code, description, dangerClass?, parentCode?, level }

ONEMLI KURALLAR:
- SADECE bu dosyalari degistir: NaceCodeController.cs, NaceCodeService.cs, INaceCodeService.cs
- Yeni Request model dosyalari olusturabilirsin: Models/Requests/ altina
- MEVCUT GET endpoint'lerine DOKUNMA
- Mevcut NaceCodeResponse modelini kullan
- BaseResponseModel pattern'ini kullan (diger servislerdeki gibi)
- Islem sonunda 'dotnet build' ile kontrol et, HATA VARSA DUZELT
- Admin yetkisi kontrolu ekle: sadece Admin rolu olan kullanicilar CRUD yapabilmeli`;

const step2Prompt = `Backend'e eklenen NACE CRUD endpoint'leri icin frontend admin panel dokumantasyonu hazirla.

ONEMLI: KOD YAZMA! Sadece dokuman uret.

Dokumani C:/Users/HP/source/repos/Karbon/docs/FRONTEND-NACE-ADMIN-PANEL.md olarak yaz.

Backend agent'in olusturdugu yeni endpoint'leri incele:
- NaceCodeController.cs deki yeni POST/PUT/DELETE endpoint'leri oku
- Request model'lerini oku
- Validasyon kurallarini oku

Dokumanda sunlar olmali:

1. ADMIN PANEL SAYFA TASARIMI
   - NACE kodlari listesi (tablo: Code, Description, Level, DangerClass, ParentCode, Actions)
   - Filtreleme: Level'a gore, DangerClass'a gore, arama
   - Sayfalama

2. EKLEME FORMU
   - Yeni NACE kodu ekleme modal/sayfa
   - Parent secimi (mevcut kodlardan dropdown/autocomplete)
   - Level otomatik hesaplama (parent'in level'i + 1)
   - DangerClass sadece Level 5'te aktif

3. DUZENLEME FORMU
   - Mevcut kodu duzenleme
   - Ayni validasyonlar

4. SILME
   - Onay dialog'u
   - Children varsa uyari
   - Firmaya atanmissa uyari + force secenegi

5. API ENDPOINT DETAYLARI
   - Her endpoint icin URL, method, request/response ornekleri
   - Hata durumlari ve mesajlar
   - TypeScript type tanimlari

6. UI MOCKUP'LAR (ASCII art)

Bu dokuman SADECE admin kullanicilar icin olan NACE yonetim paneli icindir.
Kullanici tarafindaki NaceCodePicker (FRONTEND-NACE-INTEGRATION.md) ayri bir seydir.`;

// Use JSON array format for depends_on (consistent with workflow engine)
db.prepare("INSERT INTO workflow_steps (id, workflow_id, role, title, prompt, depends_on, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
  STEP1_ID, WORKFLOW_ID, "backend", "NACE Kodu CRUD Endpoint Ekleme", step1Prompt, "[]", 0
);

db.prepare("INSERT INTO workflow_steps (id, workflow_id, role, title, prompt, depends_on, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
  STEP2_ID, WORKFLOW_ID, "frontend-doc", "NACE Admin Panel Frontend Dokumantasyonu", step2Prompt, JSON.stringify([STEP1_ID]), 1
);

console.log("Steps inserted:");
console.log("  Step 1 (backend):", STEP1_ID);
console.log("  Step 2 (frontend-doc):", STEP2_ID, "depends_on:", JSON.stringify([STEP1_ID]));
db.close();
