# Deploy sfl-agent lên server

Hướng dẫn chạy **Web Chat** trên server Linux (Ubuntu/Debian khuyên dùng). Server cần **Ollama + embedding** (`nomic-embed-text`); phần trả lời chat do **Cursor API** xử lý (qua `CURSOR_API_KEY`).

## Kiến trúc trên server

```
Trình duyệt (LAN)  →  sfl-agent :3847  →  Cursor API (cloud)
                              ↓
                         Ollama :11434  (embed search / MCP tools)
                              ↓
                         LanceDB + repo clone (data/)
```

| Thành phần | Ghi chú |
|------------|---------|
| Ollama `nomic-embed-text` | Embed khi search/index |
| sfl-agent (Node) | Web UI + MCP |
| LanceDB + index | Source code đã chunk (thư mục `data/`) |

Index lần đầu trên server **CPU yếu (Intel N100, không GPU)** sẽ chậm vì Ollama embed chạy thuần CPU — **nên copy sẵn `data/lancedb` từ máy dev** thay vì `pnpm index` lại trên server.

Nếu vẫn phải index trên server: giữ `EMBED_CONCURRENCY=1` (mặc định). Trước đây app từng bắn 16 embed song song → full 4 core nhưng chậm hơn tuần tự.

---

## 1. Chuẩn bị OS

```bash
sudo apt update
sudo apt install -y git curl build-essential python3
```

### Node.js 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x
corepack enable
corepack prepare pnpm@latest --activate
```

### Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable ollama
sudo systemctl start ollama
ollama pull nomic-embed-text
curl http://127.0.0.1:11434/api/tags   # kiểm tra
```

---

## 2. Đưa source lên server

### Cách A — Git

```bash
sudo mkdir -p /opt/sfl-agent
sudo chown $USER:$USER /opt/sfl-agent
git clone <url-repo-cua-ban> /opt/sfl-agent
cd /opt/sfl-agent
pnpm install
```

### Cách B — Copy từ máy dev (giữ sẵn index)

Trên **máy dev**, sync project (không cần `node_modules`):

```bash
scp -r /path/to/sfl-agent user@<server-ip>:/opt/sfl-agent
```

Hoặc chỉ copy dữ liệu đã index:

```bash
scp -r /path/to/sfl-agent/data user@<server-ip>:/opt/sfl-agent/
```

Trên **server**:

```bash
cd /opt/sfl-agent
pnpm install    # build lại native modules (sqlite3) cho Linux
```

> **Quan trọng:** `node_modules` nên cài trên server, không copy từ OS khác.

---

## 3. Cấu hình `.env`

```bash
cp .env.example .env
nano .env
```

Tối thiểu cho production LAN:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_EMBED_MODEL=nomic-embed-text

CURSOR_API_KEY=your-key-from-cursor-dashboard
CURSOR_MODEL=composer-2.5

# Lắng nghe mọi interface trong LAN (không chỉ localhost)
WEB_HOST=0.0.0.0
WEB_PORT=3847

# CPU-only (N100): giữ concurrency=1
EMBED_CONCURRENCY=1
EMBED_NUM_CTX=2048
```

Giữ nguyên `LANCEDB_PATH`, `SFL_REPO_PATH` mặc định (`./data/...`).

---

## 4. Index lần đầu (nếu chưa copy `data/lancedb`)

```bash
cd /opt/sfl-agent
pnpm index
```

Có thể chạy trong `tmux`/`screen` vì lâu. Resume được nếu bị ngắt.

Kiểm tra:

```bash
pnpm dev status
pnpm dev search "iron mine"
```

---

## 5. Tự cập nhật index mỗi 10 phút (crontab)

`pnpm index` **git pull** repo Sunflower Land rồi embed incremental (chỉ chunk mới). Chạy **process riêng** — không nhúng vào web server (tránh tranh Ollama/LanceDB với chat, dễ treo sau một thời gian).

```bash
mkdir -p /opt/sfl-agent/logs
crontab -e
```

```cron
*/10 * * * * cd /opt/sfl-agent && /usr/bin/flock -n /tmp/sfl-agent-index.lock /usr/bin/env PATH="/usr/bin:$HOME/.local/share/pnpm:$PATH" pnpm index >> /opt/sfl-agent/logs/index-cron.log 2>&1
```

| Phần | Ý nghĩa |
|------|---------|
| `*/10 * * * *` | Mỗi 10 phút |
| `flock -n ...lock` | Bỏ qua nếu lần index trước chưa xong |
| `pnpm index` | Pull `main` + embed chunk mới (không `--force`) |

Kiểm tra: `crontab -l` rồi `tail -f /opt/sfl-agent/logs/index-cron.log`.

- Lần đầu: copy `data/lancedb` hoặc `pnpm index` tay trước khi bật cron.
- Cron không cập nhật code **sfl-agent** — chỉ clone `data/sunflower-land` + LanceDB.
- Đừng `--force` trên cron. NFT không cần lịch (API live).

---

## 6. Chạy thử tay

```bash
pnpm build
pnpm start
# hoặc dev: pnpm web
```

Từ máy khác trong LAN: `http://<server-ip>:3847`

---

## 7. Systemd (tự khởi động)

Build trước khi bật service (systemd chạy `node dist/web/main.js`, không dùng `tsx`):

```bash
cd /opt/sfl-agent
pnpm install
pnpm build
```

```bash
sudo cp deploy/sfl-agent.service /etc/systemd/system/
# Sửa User/Group (thay YOUR_USER) và WorkingDirectory nếu không dùng /opt/sfl-agent
sudo systemctl daemon-reload
sudo systemctl enable sfl-agent
sudo systemctl start sfl-agent
sudo systemctl status sfl-agent
journalctl -u sfl-agent -f
```

---

## 8. Firewall

Chỉ mở port trong LAN, **không** expose ra internet công cộng (có `CURSOR_API_KEY`):

```bash
sudo ufw allow from 192.168.0.0/16 to any port 3847
sudo ufw enable
```

Đổi subnet cho đúng mạng của bạn.

---

## 9. (Tuỳ chọn) Nginx + HTTPS / Basic auth

Nếu cần truy cập từ ngoài hoặc thêm mật khẩu, đặt Nginx reverse proxy trước `127.0.0.1:3847` và bật TLS (Let's Encrypt) + `auth_basic`.

Ví dụ proxy tối giản:

```nginx
server {
    listen 80;
    server_name sfl.example.com;

    location / {
        proxy_pass http://127.0.0.1:3847;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_buffering off;          # SSE chat
        proxy_read_timeout 600s;
    }
}
```

---

## 10. Cập nhật sau này

```bash
cd /opt/sfl-agent
git pull
pnpm install
pnpm build
pnpm index          # cập nhật source index (incremental) — hoặc để crontab mục 5
sudo systemctl restart sfl-agent
```

API giá/NFT/tỷ giá **không cần index** — luôn live từ sfl.world.

---

## 11. Xử lý sự cố

| Triệu chứng | Kiểm tra |
|-------------|----------|
| `203/EXEC`, `Failed to locate executable ... tsx` | Chạy `pnpm install && pnpm build`; service dùng `node dist/web/main.js` (xem `deploy/sfl-agent.service`) |
| `dist/web/main.js` không tồn tại | `cd /opt/sfl-agent && pnpm build` |
| `Ollama off` trên UI | `systemctl status ollama`, `curl localhost:11434/api/tags` |
| `Thiếu API key` | `CURSOR_API_KEY` trong `.env`, restart service |
| Chat chậm | Bình thường với Cursor API; tin đầu tiên tạo agent + spawn MCP nên chậm hơn tin sau |
| `sqlite3` lỗi | `pnpm install` lại trên Linux |
| Không vào được từ máy khác | `WEB_HOST=0.0.0.0`, firewall port 3847 |
| Cron index không chạy | `crontab -l`, `tail` log; cron thường thiếu `PATH` — dùng full path như mục 5 |
| Chat treo sau một lúc, phải restart web | Xem `journalctl -u sfl-agent`; không chạy index trong cùng process web |

---

## Checklist nhanh

- [ ] Node 20+, pnpm, git
- [ ] Ollama + `nomic-embed-text`
- [ ] Source tại `/opt/sfl-agent`, `pnpm install`, `pnpm build`
- [ ] `.env` có `CURSOR_API_KEY`, `WEB_HOST=0.0.0.0`
- [ ] `data/lancedb` đã có (copy hoặc `pnpm index`)
- [ ] Crontab `*/10` + `flock` cho `pnpm index` (mục 5) — không index trong web process
- [ ] `systemctl enable sfl-agent`
- [ ] Firewall chỉ LAN
