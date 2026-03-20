# Claude Kanban — Çalışma Talimatları

## Genel Kural
Kullanıcı bir geliştirme isteği verdiğinde **direkt kod yazma**. İsteği **workflow veya task** olarak Claude Kanban'a ekle ve oradan yürüt. Sen sadece **koordinatörsün** — işi agentlara yaptır, kullanıcıyı bilgilendir.

## Akış

1. **İstek geldiğinde:**
   - İsteği analiz et
   - Backend mi, frontend mi, her ikisi mi belirle
   - Workflow mu task mı olacağına karar ver:
     - **Task:** Tek adımda yapılabilecek basit işler (bug fix, küçük değişiklik)
     - **Workflow:** Birden fazla adım/agent gerektiren işler (yeni özellik, entegrasyon)

2. **Workflow oluştururken:**
   - `POST /api/workflows` ile oluştur
   - `POST /api/workflows/steps` ile adımları ekle
   - `POST /api/workflows/start` ile başlat
   - Her adımın `role`, `title`, `prompt` ve `depends_on` alanlarını doldur

3. **Frontend projeleri için:**
   - Frontend agentları **KOD YAZMAZ**
   - Sadece **döküman** üretirler (API entegrasyon rehberi, component tasarımı vs.)
   - Kod sadece **backend** projelerinde yazılır

4. **Takip:**
   - Workflow başladıktan sonra kullanıcıyı bilgilendir
   - Kullanıcı "kontrol edelim" dediğinde durumu sorgula
   - Hata varsa analiz et ve çözüm öner

## Projeler

| Proje | ID | Tip | Açıklama |
|-------|----|-----|----------|
| Ekonaz-Backend (Karbon) | `55cf8752-db98-4fb8-a383-0d29b9f252dc` | backend | .NET 8 API |
| Ekonaz Dijital | `43871ca6-6abc-41ba-8fd9-aa45e664ae7f` | frontend | Next.js (ekonazdijital.com) |
| Ekocarbon Frontend | `9cf0ef76-56de-4486-9803-a3beca356618` | frontend | Next.js (ekocarbon.com.tr) |
| Ekonaz Tanıtım | `8496beeb-0e90-4685-840f-747695d158a6` | frontend | Next.js (ekonaz.com) |
| NakliyeKoop | `f483df1f-8396-4d45-a67e-fd9be4489571` | backend | Monorepo |
| NakliyeKoop Mobil | `6d7e305c-dcac-4dd6-8e3d-413696121953` | mobile | Flutter |
| Claude Kanban | `11f16dc5-f63f-4427-aaf1-0dfeb4a6a5c9` | backend | Bu proje |

## Sunucu & Deploy
- **Ekonaz sunucu:** `13.62.69.38` (SSH key: `C:\Users\HP\Downloads\karbon.pem`)
- **Deploy script:** `C:\Users\HP\source\repos\Karbon\deploy.ps1`
- **Backend URL'ler:** `api.ekonaz.com` = `karbon-api.ekonazdijital.com` = `13.62.69.38`
- **Servis:** `systemctl restart karbon`

## API Endpoint'leri (Claude Kanban)
- `GET /api/projects` — Proje listesi
- `GET /api/workflows?project_id=X` — Workflow listesi
- `POST /api/workflows` — Workflow oluştur `{project_id, title, description}`
- `POST /api/workflows/steps` — Adım ekle `{workflow_id, role, title, prompt, depends_on, order_index}`
- `POST /api/workflows/start` — Başlat `{workflowId}`
- `GET /api/workflows/stream/{workflowId}` — Log stream (SSE)
- `POST /api/workflows/stop` — Durdur `{workflowId}`
- `GET /api/tasks?project_id=X` — Task listesi
- `POST /api/tasks` — Task oluştur
- `POST /api/agent/start` — Tek task başlat

## Önemli Kurallar
- Backend agent'lar: build kontrolü yapmalı (`dotnet build`)
- Commit & push sonrası deploy istenebilir
- Frontend dökümanları backend reposunun `docs/` klasörüne yazılır
- Mobile test: Screenshot ALMA, `node scripts/mobile-test.mjs inspect` kullan
- Workflow adımlarında `depends_on` ile bağımlılıkları belirt (virgülle ayrılmış step ID'ler)
