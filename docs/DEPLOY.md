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

Index lần đầu trên server có thể mất khá lâu tùy CPU/RAM — có thể copy sẵn `data/lancedb` từ máy dev.

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
WEB_WARM_AGENT=true
WEB_SHARED_AGENT=true
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

## 5. Chạy thử tay

```bash
pnpm build
pnpm start
# hoặc dev: pnpm web
```

Từ máy khác trong LAN: `http://<server-ip>:3847`

---

## 6. Systemd (tự khởi động)

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

## 7. Firewall

Chỉ mở port trong LAN, **không** expose ra internet công cộng (có `CURSOR_API_KEY`):

```bash
sudo ufw allow from 192.168.0.0/16 to any port 3847
sudo ufw enable
```

Đổi subnet cho đúng mạng của bạn.

---

## 8. (Tuỳ chọn) Nginx + HTTPS / Basic auth

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

## 9. Cập nhật sau này

```bash
cd /opt/sfl-agent
git pull
pnpm install
pnpm build
pnpm index          # cập nhật source index (incremental)
sudo systemctl restart sfl-agent
```

API giá/NFT/tỷ giá **không cần index** — luôn live từ sfl.world.

---

## 10. Xử lý sự cố

| Triệu chứng | Kiểm tra |
|-------------|----------|
| `203/EXEC`, `Failed to locate executable ... tsx` | Chạy `pnpm install && pnpm build`; service dùng `node dist/web/main.js` (xem `deploy/sfl-agent.service`) |
| `dist/web/main.js` không tồn tại | `cd /opt/sfl-agent && pnpm build` |
| `Ollama off` trên UI | `systemctl status ollama`, `curl localhost:11434/api/tags` |
| `Thiếu API key` | `CURSOR_API_KEY` trong `.env`, restart service |
| Chat chậm | Bình thường với Cursor API; `WEB_WARM_AGENT=true` giúp tin đầu nhanh hơn |
| `sqlite3` lỗi | `pnpm install` lại trên Linux |
| Không vào được từ máy khác | `WEB_HOST=0.0.0.0`, firewall port 3847 |

---

## Checklist nhanh

- [ ] Node 20+, pnpm, git
- [ ] Ollama + `nomic-embed-text`
- [ ] Source tại `/opt/sfl-agent`, `pnpm install`, `pnpm build`
- [ ] `.env` có `CURSOR_API_KEY`, `WEB_HOST=0.0.0.0`
- [ ] `data/lancedb` đã có (copy hoặc `pnpm index`)
- [ ] `systemctl enable sfl-agent`
- [ ] Firewall chỉ LAN
