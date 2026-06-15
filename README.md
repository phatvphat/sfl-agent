# SFL Agent

MCP server để tra cứu và nghiên cứu **Sunflower Land** qua source code frontend công khai và API giá/tỷ giá từ [sfl.world](https://sfl.world). Có thể dùng qua **Cursor IDE (MCP)** hoặc **Web Chat** (Cursor SDK + MCP sfl-agent).

## Web Chat (khuyên dùng để tra cứu)

Giao diện chat đơn giản tại `http://127.0.0.1:3847` — dùng **Cursor API key** + MCP sfl-agent, không cần mở IDE.

```bash
# 1. Thêm key vào .env
#    CURSOR_API_KEY=your-key-from-cursor-dashboard

# 2. Đảm bảo Ollama chạy + đã index
pnpm index

# 3. Chạy web server
pnpm web
```

Mở trình duyệt: **http://127.0.0.1:3847**

**Tăng tốc phản hồi:** mặc định `pnpm web` sẽ **pre-warm** Cursor agent + MCP ngay khi khởi động (không cần đợi tin nhắn đầu tiên). Dùng chung một agent (`WEB_SHARED_AGENT=true`) cho mọi phiên chat.

| Biến `.env` | Mặc định | Mô tả |
|-------------|----------|--------|
| `WEB_WARM_AGENT` | `true` | Tạo agent + MCP khi server start |
| `WEB_SHARED_AGENT` | `true` | Một agent dùng chung (nhanh hơn, phù hợp dùng cá nhân) |
| `WEB_REUSE_AGENT` | `true` | Resume agent cũ khi restart `pnpm web` (không tạo agent mới mỗi lần) |
| `WEB_WARM_MCP_PING` | `false` | Gửi prompt nhỏ lúc startup để warm MCP (tốn quota) |

| Biến `.env` | Mô tả |
|-------------|--------|
| `CURSOR_API_KEY` | API key từ [Cursor Dashboard](https://cursor.com/dashboard) |
| `CURSOR_MODEL` | Model agent (mặc định `composer-2.5`) |
| `WEB_PORT` | Cổng web UI (mặc định `3847`) |

Usage được tính theo plan Cursor (giống IDE Agent). API key **chỉ** nằm trên server — không đưa ra frontend.

**Cursor SDK (web):** mặc định **mỗi lần tải lại trang** gọi `POST /api/session`, hủy agent cũ và xóa checkpoint trong RAM — hội thoại không giữ lại giữa các lần mở tab/reload. Trong cùng một lần mở trang, các tin nhắn tiếp theo vẫn multi-turn. Muốn giữ context qua reload: `WEB_PERSIST_CHAT_CONTEXT=true`. Không ghi file dưới `data/cursor-agents/`.

**MCP sfl-agent khi nào chạy?** `pnpm web` chỉ khởi động HTTP server. Process MCP **không** chạy ngay — Cursor SDK **spawn** `scripts/start-mcp.mjs` khi bạn **gửi tin nhắn chat đầu tiên** (mỗi session). Tắt `pnpm web` → MCP cũng tắt theo.

## Kiến trúc

```
Web UI / Cursor IDE
       │
       ▼
  sfl-agent (Node.js)
   ├── Web: Cursor SDK + MCP sfl-agent
   ├── MCP tools: search, read file, index, live prices/exchange/NFTs
   ├── LanceDB (vector store)  ./data/lancedb  ← source code only
   ├── Ollama embeddings       localhost:11434 / nomic-embed-text
   ├── sfl.world APIs (live)   prices, exchange, NFT floors
   └── Git clone               ./data/sunflower-land
         └── github.com/sunflower-land/sunflower-land
```

## Yêu cầu

- Node.js 20+
- [pnpm](https://pnpm.io/)
- [Ollama](https://ollama.com/) đang chạy tại `localhost:11434`
- Model embedding: `nomic-embed-text`

```bash
ollama pull nomic-embed-text
```

## Cài đặt

```bash
cd E:\Projects\sfl-agent
pnpm install
copy .env.example .env
```

> `pnpm install` sẽ build native module `sqlite3` (cần cho Cursor SDK). Nếu `pnpm web` báo lỗi sqlite3, chạy lại `pnpm install`.

## Index source code (bắt buộc lần đầu)

Lệnh này clone repo [sunflower-land](https://github.com/sunflower-land/sunflower-land), chunk file `.ts`/`.tsx`/`.md`, embed qua Ollama và lưu vào LanceDB.

```bash
pnpm index
```

Quá trình có thể mất vài phút tùy máy (embed từng batch). **Mỗi batch embed xong sẽ lưu ngay vào `data/lancedb/`** — nếu lỗi giữa chừng, chạy lại `pnpm index` sẽ **resume** (bỏ qua chunk đã có, không tạo duplicate).

> Giá tài nguyên, tỷ giá và NFT **không** cần index — agent gọi API trực tiếp qua MCP (`sfl_resource_prices`, `sfl_exchange`, `sfl_nft_prices`).

> Nếu gặp lỗi schema kiểu `Found field not in schema` (từ bản index cũ), chạy `pnpm index -- --force` để xóa DB và build lại.

Để xóa index cũ và build lại từ đầu:

```bash
pnpm index -- --force
```

## Kết nối Cursor IDE

Có **2 cách** bật MCP. Chỉ cần **một** — tránh bật trùng cả project lẫn global.

### Cách 1: Project MCP (khuyên dùng — mở folder `sfl-agent` trong Cursor)

File [`.cursor/mcp.json`](.cursor/mcp.json) đã cấu hình sẵn. Mở project này trong Cursor → MCP tự nhận.

### Cách 2: Global MCP (Cursor Settings → MCP, dùng mọi project)

Global settings **không có** `cwd` project → đường dẫn tương đối (`src/mcp/server.ts`, `--import tsx`) thường **lỗi** `Connection closed`.

Dùng launcher tự resolve đường dẫn — copy từ [`docs/cursor-mcp-global.json`](docs/cursor-mcp-global.json):

```json
{
  "mcpServers": {
    "sfl-agent": {
      "command": "node",
      "args": ["E:\\Projects\\sfl-agent\\scripts\\start-mcp.mjs"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "OLLAMA_EMBED_MODEL": "nomic-embed-text"
      }
    }
  }
}
```

**Lưu ý global MCP:**
- `args` phải là **đường dẫn tuyệt đối** tới `scripts/start-mcp.mjs`
- **Không** dùng `pnpm`, **không** dùng path tương đối `src/...`
- Không cần field `cwd` (launcher tự `chdir` về project)

**Nếu vẫn lỗi**, đổi `command` thành đường dẫn đầy đủ `node.exe` (chạy `where node`):

```json
"command": "C:\\Program Files\\nodejs\\node.exe",
"args": ["E:\\Projects\\sfl-agent\\scripts\\start-mcp.mjs"]
```

Sau khi sửa config: **tắt/bật lại MCP** hoặc restart Cursor. Trạng thái phải **Connected** (xanh).

Sau khi bật MCP, trong chat Agent bạn có thể hỏi trực tiếp, ví dụ:

- *"Công thức craft axe trong Sunflower Land là gì?"*
- *"Tìm logic harvest crop trong source code"*
- *"Đọc file định nghĩa Bumpkin skills"*

- *"Giá Iron trên marketplace hiện tại?"*
- *"Giá sàn NFT Walrus Onesie?"*
- *"1 SFL bằng bao nhiêu USD?"*
- *"Gói 650 gems giá bao nhiêu SFL?"*

Agent gọi API trực tiếp (`sfl_resource_prices`, `sfl_nft_prices`, `sfl_exchange`) hoặc tìm source code (`sfl_search`).

## MCP Tools

| Tool | Mô tả |
|------|--------|
| `sfl_search` | Tìm kiếm ngữ nghĩa trên source + docs đã index |
| `sfl_read_file` | Đọc file gốc từ repo clone (có line range) |
| `sfl_index` | Cập nhật repo + rebuild index source code |
| `sfl_status` | Kiểm tra Ollama, số record LanceDB |
| `sfl_resource_prices` | Giá tài nguyên P2P ([api/v1/prices](https://sfl.world/api/v1/prices)) |
| `sfl_exchange` | Tỷ giá SFL/USD, gems, coins ([api/v1.1/exchange](https://sfl.world/api/v1.1/exchange)) |
| `sfl_nft_prices` | Giá sàn NFT (SFL), buff `have_boost` ([api/v1/nfts](https://sfl.world/api/v1/nfts)) |
| `sfl_marketplace_price` | Alias của `sfl_resource_prices` |
| `sfl_usd_rate` | Alias của `sfl_exchange` (chỉ SFL) |
| `sfl_index_nfts` | *(tuỳ chọn)* Cache catalog NFT vào LanceDB để `sfl_search` tìm theo tên/buff |

## CLI thử nhanh

```bash
pnpm dev status
pnpm dev prices Iron
pnpm dev nfts "Walrus Onesie"
pnpm dev exchange
pnpm dev search "iron mine recipe"
```

## Cấu hình (.env)

| Biến | Mặc định |
|------|----------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` |
| `LANCEDB_PATH` | `./data/lancedb` |
| `SFL_REPO_URL` | repo GitHub chính thức |
| `CHUNK_SIZE` | `1000` (ký tự mỗi chunk) |
| `MAX_EMBED_CHARS` | `4000` (giới hạn gửi Ollama, tránh lỗi context length) |
| `SFL_PRICES_API_URL` | `https://sfl.world/api/v1/prices` |
| `SFL_EXCHANGE_API_URL` | `https://sfl.world/api/v1.1/exchange` |
| `SFL_NFTS_API_URL` | `https://sfl.world/api/v1/nfts` |

API responses được cache 5 phút trong memory để giảm số lần gọi.

## Deploy lên server

Xem **[docs/DEPLOY.md](docs/DEPLOY.md)** — cài Node + Ollama, copy source/index, systemd, firewall LAN.

Tóm tắt:

```bash
# Trên server Linux
git clone <repo> /opt/sfl-agent && cd /opt/sfl-agent
pnpm install && cp .env.example .env   # thêm CURSOR_API_KEY, WEB_HOST=0.0.0.0 cho LAN
pnpm index   # hoặc copy data/lancedb từ máy dev
sudo cp deploy/sfl-agent.service /etc/systemd/system/  # sửa User=
sudo systemctl enable --now sfl-agent
```

Truy cập LAN: `http://<ip-server>:3847` (đặt `WEB_HOST=0.0.0.0` trong `.env`).

## Lưu ý pháp lý

Source và assets Sunflower Land có giới hạn license — chỉ dùng cho tra cứu cá nhân/nghiên cứu, tuân thủ [repo README](https://github.com/sunflower-land/sunflower-land).
