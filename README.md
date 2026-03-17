# Claude Kanban

Claude Code Agent'larını görsel bir Kanban panosu üzerinden yöneten AI destekli task management uygulaması. Projelerinize task'lar ekleyin, Claude Code agent'ları ile otomatik olarak çalıştırın ve ilerlemeyi gerçek zamanlı takip edin.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57)

## Özellikler

### Kanban Panosu
- **4 kolonlu board**: Yapılacak, Devam Ediyor, Tamamlandı, Hata
- **Sürükle-bırak** ile task'ları kolonlar arasında taşıma
- **Arama**: Task başlığı ve açıklamasında anlık filtreleme
- **Sıralama**: Tarihe veya önceliğe göre sıralama
- **Responsive tasarım**: Mobilde hamburger menü ile sidebar

### Task Yönetimi
- **Öncelik sistemi**: Yüksek / Orta / Düşük öncelik seviyeleri
- **Şablonlar**: Bug Fix, Feature, Refactor, Test Yaz, Dokümantasyon şablonları ile hızlı task oluşturma
- **Alt adımlar (checklist)**: Markdown checklist formatında (`- [ ] item`) alt görevler
- **İlerleme çubuğu**: Hem agent ilerlemesi hem checklist tamamlanma oranı
- **Task zincirleme**: Bir task tamamlanınca otomatik olarak sonraki task'ı başlatma
- **Otomatik yeniden deneme**: Hata durumunda 1-3 kez otomatik retry

### Agent Sistemi
- **Claude Code CLI** üzerinden agent çalıştırma (`npx claude -p`)
- **Gerçek zamanlı log akışı**: SSE (Server-Sent Events) ile canlı log izleme
- **Agent durdurma**: Çalışan agent'ı istediğiniz zaman durdurabilme
- **Araç kontrolü**: Proje bazında izin verilen araçları seçme (Read, Edit, Bash, vb.)
- **Max turns**: Agent'ın maksimum dönüş sayısını ayarlama
- **Çalışma geçmişi**: Her agent çalışmasının logları, maliyeti ve süresi kayıt altında

### Proje Yönetimi
- **Çoklu proje** desteği — her proje kendi path'ine ve ayarlarına sahip
- **Proje renkleri** ile görsel ayrım
- **İstatistikler**: Task sayıları, başarı oranı, toplam maliyet ve süre

### Klavye Kısayolları
- `N` — Yeni task oluştur
- `Esc` — Açık modali kapat

## Teknoloji

| Katman | Teknoloji |
|--------|-----------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Veritabanı | SQLite (better-sqlite3, WAL mode) |
| Agent | Claude Code CLI (`@anthropic-ai/claude-code`) |
| Realtime | Server-Sent Events (SSE) |

## Kurulum

### Gereksinimler
- Node.js 18+
- npm
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) yüklü ve yapılandırılmış olmalı

### Adımlar

```bash
# Repo'yu klonla
git clone https://github.com/abdurrahmanyesilyurt/claude-kanban.git
cd claude-kanban

# Bağımlılıkları yükle
npm install

# Geliştirme sunucusunu başlat
npm run dev
```

Uygulama varsayılan olarak [http://localhost:3000](http://localhost:3000) adresinde çalışacaktır.

> **Not:** Veritabanı (`kanban.db`) ilk çalıştırmada otomatik olarak oluşturulur. Herhangi bir migration veya seed komutu çalıştırmanıza gerek yoktur.

## Kullanım

### 1. Proje Oluştur
Sol sidebar'dan "Yeni Proje" butonuna tıklayın. Proje adı, hedef klasör yolu, renk, izin verilen araçlar ve max turns değerlerini girin.

### 2. Task Ekle
Toolbar'daki "Yeni Task" butonuna tıklayın veya `N` tuşuna basın. Şablonlardan birini seçerek hızlıca doldurabilir veya manuel olarak başlık, açıklama ve öncelik belirleyebilirsiniz.

### 3. Agent Başlat
Task kartındaki "Agent Başlat" butonuna tıklayın. Claude Code agent'ı belirtilen proje dizininde çalışmaya başlayacaktır. Canlı logları "Log" butonundan takip edebilirsiniz.

### 4. İlerlemeyi Takip Et
- Kanban kartlarındaki ilerleme çubuğunu izleyin
- Stats bar'dan toplam istatistikleri görün
- Agent geçmişinden önceki çalışmaların detaylarına ulaşın

## Proje Yapısı

```
claude-kanban/
├── app/
│   ├── api/
│   │   ├── agent/
│   │   │   ├── runs/route.ts      # Agent çalışma geçmişi
│   │   │   ├── start/route.ts     # Agent başlatma
│   │   │   └── stop/route.ts      # Agent durdurma
│   │   ├── logs/route.ts          # SSE log stream
│   │   ├── projects/route.ts      # Proje CRUD
│   │   ├── stats/route.ts         # İstatistikler
│   │   └── tasks/route.ts         # Task CRUD
│   ├── components/
│   │   ├── AgentLogPanel.tsx       # Log paneli + geçmiş
│   │   ├── EditTaskModal.tsx       # Task düzenleme (checklist, chain, retry)
│   │   ├── KanbanBoard.tsx         # Ana board bileşeni
│   │   ├── NewTaskModal.tsx        # Yeni task (şablonlar + öncelik)
│   │   ├── Sidebar.tsx             # Proje sidebar'ı
│   │   ├── StatsBar.tsx            # İstatistik çubuğu
│   │   └── Toast.tsx               # Bildirim sistemi
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── lib/
│   ├── claude-agent.ts             # Agent yönetimi + retry + chaining
│   ├── db.ts                       # Veritabanı + migration'lar
│   └── types.ts                    # Paylaşılan tipler
├── package.json
└── tsconfig.json
```

## API Endpoints

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/projects` | Tüm projeleri listele |
| POST | `/api/projects` | Yeni proje oluştur |
| GET | `/api/tasks?projectId=` | Task'ları listele |
| POST | `/api/tasks` | Yeni task oluştur |
| PATCH | `/api/tasks` | Task güncelle |
| DELETE | `/api/tasks?id=` | Task sil |
| POST | `/api/agent/start` | Agent başlat |
| POST | `/api/agent/stop` | Agent durdur |
| GET | `/api/agent/runs?taskId=` | Agent çalışma geçmişi |
| GET | `/api/logs?taskId=` | SSE log stream |
| GET | `/api/stats?projectId=` | İstatistikler |

## Lisans

MIT
