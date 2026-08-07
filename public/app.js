import { renderMarkdown } from "./markdown.js";

const chatEl = document.getElementById("chat");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

const SESSION_KEY = "sfl-agent-session-id";

let sessionId = null;

let stickToBottom = true;

chatEl.addEventListener(
  "scroll",
  () => {
    const dist = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
    stickToBottom = dist < 100;
  },
  { passive: true },
);

function scrollToBottom(force = false) {
  if (force || stickToBottom) {
    chatEl.scrollTop = chatEl.scrollHeight;
  }
}

async function initSession() {
  localStorage.removeItem(SESSION_KEY);

  const res = await fetch("/api/session", { method: "POST" });
  const data = await res.json();
  sessionId = data.sessionId;
}

async function ensureSession() {
  if (sessionId) return sessionId;
  await initSession();
  return sessionId;
}

function mergeAssistantText(current, incoming) {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.endsWith(incoming)) return current;
  return current + incoming;
}

function formatChatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function createMsgTime(label, date) {
  const el = document.createElement("time");
  el.className = "msg-time";
  el.dateTime = date.toISOString();
  el.textContent = `${label} ${formatChatTime(date)}`;
  return el;
}

async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}

function createCopyBtn(getText) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "msg-copy";
  btn.title = "Sao chép";
  btn.setAttribute("aria-label", "Sao chép nội dung");
  btn.innerHTML = '<span class="msg-copy-icon" aria-hidden="true">⎘</span>';
  btn.addEventListener("click", async () => {
    const text = typeof getText === "function" ? getText() : getText;
    if (!text?.trim()) return;
    try {
      await copyToClipboard(text);
      btn.classList.add("copied");
      btn.title = "Đã sao chép";
      const icon = btn.querySelector(".msg-copy-icon");
      const prev = icon?.textContent ?? "⎘";
      if (icon) icon.textContent = "✓";
      window.setTimeout(() => {
        btn.classList.remove("copied");
        btn.title = "Sao chép";
        if (icon) icon.textContent = prev;
      }, 1200);
    } catch {
      btn.title = "Không sao chép được";
      window.setTimeout(() => {
        btn.title = "Sao chép";
      }, 1200);
    }
  });
  return btn;
}

function createMsgFooter(label, date, getCopyText) {
  const footer = document.createElement("div");
  footer.className = "msg-footer";
  const time = createMsgTime(label, date);
  footer.append(time, createCopyBtn(getCopyText));
  return { footer, time };
}

function markReceived(ui, date = new Date()) {
  if (ui.receivedAt) return;
  ui.receivedAt = date;
  ui.assistantTime.hidden = false;
  ui.assistantTime.dateTime = date.toISOString();
  ui.assistantTime.textContent = `Nhận ${formatChatTime(date)}`;
}

function createTurn(userText) {
  const sentAt = new Date();
  const ui = {
    copyText: "",
    sentAt,
    receivedAt: null,
    toolCounts: new Map(),
    hasText: false,
    toolsFinished: false,
  };

  const turn = document.createElement("div");
  turn.className = "turn";

  const userMsg = document.createElement("div");
  userMsg.className = "msg user";
  const userContent = document.createElement("div");
  userContent.className = "msg-content";
  userContent.textContent = userText;
  const userFooter = createMsgFooter("Gửi", sentAt, () => userText);
  userMsg.append(userContent, userFooter.footer);

  const activity = createActivityElement();

  const assistant = document.createElement("div");
  assistant.className = "msg assistant";
  assistant.hidden = true;
  const body = document.createElement("div");
  body.className = "msg-body md-content";
  const assistantFooter = createMsgFooter("Nhận", sentAt, () => ui.copyText);
  assistantFooter.time.hidden = true;
  assistant.append(body, assistantFooter.footer);

  turn.append(userMsg, activity, assistant);
  chatEl.appendChild(turn);
  scrollToBottom(true);

  Object.assign(ui, {
    turn,
    assistant,
    body,
    assistantTime: assistantFooter.time,
  });
  bindActivityRefs(ui, activity);

  return ui;
}

function bindActivityRefs(ui, activity) {
  ui.activity = activity;
  ui.pills = activity.querySelector(".tool-pills");
  ui.activityText = activity.querySelector(".activity-text");
  ui.spinner = activity.querySelector(".spinner");
}

function createActivityElement() {
  const activity = document.createElement("div");
  activity.className = "activity";
  activity.hidden = true;
  activity.innerHTML = `
    <div class="activity-label">
      <span class="spinner"></span>
      <span class="activity-text">Đang xử lý...</span>
    </div>
    <div class="tool-pills"></div>
  `;
  return activity;
}

function ensureActivity(ui) {
  if (ui.activity?.isConnected) return;
  const activity = createActivityElement();
  ui.turn.insertBefore(activity, ui.assistant);
  bindActivityRefs(ui, activity);
}

function showActivity(ui, label) {
  ensureActivity(ui);
  ui.activity.hidden = false;
  ui.activity.classList.remove("collapsed");
  if (ui.spinner) ui.spinner.hidden = false;
  if (ui.pills) ui.pills.hidden = false;
  if (label && ui.activityText) ui.activityText.textContent = label;
}

/** Hide activity but keep the DOM node so later tool events don't crash. */
function dismissActivity(ui) {
  if (ui.activity) {
    ui.activity.hidden = true;
  }
}

function showAssistant(ui, options = {}) {
  const { keepActivity = false } = options;
  ui.hasText = true;
  if (!keepActivity) dismissActivity(ui);
  ui.assistant.hidden = false;
  ui.assistant.classList.remove("pending");
}

function escapeToolKey(key) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(key);
  }
  return key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function updateTool(ui, { name, status, label }) {
  ensureActivity(ui);
  const displayName = label || name || "tool";
  showActivity(ui, "Đang tra cứu...");

  if (!ui.pills) return;

  const key = String(displayName);
  if (status === "running") {
    ui.toolCounts.set(key, (ui.toolCounts.get(key) ?? 0) + 1);
  }

  let pill = ui.pills.querySelector(`[data-tool="${escapeToolKey(key)}"]`);
  if (!pill) {
    pill = document.createElement("span");
    pill.className = "tool-pill";
    pill.dataset.tool = key;
    pill.innerHTML = `<span class="icon">◌</span><span class="name"></span>`;
    ui.pills.appendChild(pill);
  }

  const runCount = ui.toolCounts.get(key) ?? 1;
  const suffix = runCount > 1 ? ` ×${runCount}` : "";
  const nameEl = pill.querySelector(".name");
  const iconEl = pill.querySelector(".icon");
  if (nameEl) nameEl.textContent = key + suffix;

  if (status === "running") {
    pill.className = "tool-pill running";
    if (iconEl) iconEl.textContent = "◌";
  } else {
    pill.className = "tool-pill done";
    if (iconEl) iconEl.textContent = "✓";
  }
}

function onToolsIdle(ui) {
  ui.toolsFinished = true;
  if (!ui.hasText && ui.activity && !ui.activity.hidden && ui.activityText) {
    ui.activityText.textContent = "Đang soạn trả lời...";
  }
}

function collapseActivitySummary(ui) {
  if (!ui.activity || ui.toolCounts.size === 0) {
    dismissActivity(ui);
    return;
  }
  const names = [...ui.toolCounts.keys()].join(", ");
  ui.activity.classList.add("collapsed");
  if (ui.activityText) ui.activityText.textContent = `Đã dùng: ${names}`;
  if (ui.spinner) ui.spinner.hidden = true;
  if (ui.pills) ui.pills.hidden = true;
}

function showWelcome() {
  if (chatEl.children.length > 0) return;
  const el = document.createElement("div");
  el.className = "welcome";
  el.innerHTML = `
    <p>Chào bạn! Chỉ hỗ trợ câu hỏi về <strong>Sunflower Land</strong> — game, giá thị trường, NFT, tỷ giá SFL.</p>
    <p>Agent dùng MCP để tìm trong source code &amp; API sfl.world. Câu hỏi ngoài phạm vi game sẽ không được trả lời.</p>
    <div class="welcome-suggestions">
      <button type="button" class="suggestion" data-q="Giá Iron trên marketplace?">Giá Iron</button>
      <button type="button" class="suggestion" data-q="1 SFL bằng bao nhiêu USD?">Tỷ giá SFL</button>
      <button type="button" class="suggestion" data-q="Thời gian trồng Sunflower là bao lâu?">Grow time Sunflower</button>
    </div>
  `;
  el.querySelectorAll(".suggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      inputEl.value = btn.dataset.q ?? "";
      formEl.requestSubmit();
    });
  });
  chatEl.appendChild(el);
}

async function loadHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    const parts = [];
    if (data.cursorApiKey) parts.push("Cursor OK");
    else parts.push("Thiếu API key");
    parts.push(`${data.agent?.sessionCount ?? 0} session`);
    if (data.ollama) parts.push("Ollama OK");
    else parts.push("Ollama off");
    parts.push(`${(data.indexedRecords ?? 0).toLocaleString()} chunks`);

    statusText.textContent = parts.join(" · ");
    statusDot.className = `dot ${data.cursorApiKey ? "ok" : "err"}`;
    await initSession();
  } catch {
    statusText.textContent = "Offline";
    statusDot.className = "dot err";
  }
}

async function sendMessage(message) {
  const welcome = chatEl.querySelector(".welcome");
  if (welcome) welcome.remove();

  const ui = createTurn(message);
  showActivity(ui, "Đang kết nối agent...");
  inputEl.value = "";
  sendBtn.disabled = true;

  let assistantText = "";
  let finalResult = "";
  let renderTimer = null;
  let toolRunning = 0;
  let toolsUsed = false;
  let thinkingText = "";
  let streamFailed = false;
  let streamFinished = false;
  let reader = null;

  const paintAssistant = (text) => {
    ui.copyText = text;
    try {
      ui.body.innerHTML = renderMarkdown(text);
    } catch (err) {
      console.error("renderMarkdown failed:", err);
      ui.body.textContent = text;
    }
    scrollToBottom();
  };

  const scheduleRender = () => {
    if (renderTimer) return;
    renderTimer = requestAnimationFrame(() => {
      renderTimer = null;
      if (streamFailed) return;
      paintAssistant(assistantText);
    });
  };

  const sessionId = await ensureSession();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message }),
    });

    if (!res.ok || !res.body) {
      streamFailed = true;
      showAssistant(ui);
      markReceived(ui);
      ui.assistant.classList.add("error");
      ui.copyText = `Lỗi HTTP ${res.status}`;
      ui.body.textContent = ui.copyText;
      return;
    }

    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        if (!block || block.startsWith(":")) continue;

        const lines = block.split("\n");
        let event = "message";
        const dataParts = [];

        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataParts.push(line.slice(5).trimStart());
        }

        const dataLine = dataParts.join("\n");
        if (!dataLine) continue;

        let data;
        try {
          data = JSON.parse(dataLine);
        } catch {
          continue;
        }

        try {
          if (event === "text" && data.delta) {
            assistantText = mergeAssistantText(assistantText, data.delta);
            ui.assistant.hidden = false;
            ui.hasText = true;
            ui.assistant.classList.add("pending");
            showActivity(
              ui,
              thinkingText ||
                (toolsUsed || toolRunning > 0
                  ? "Đang tra cứu dữ liệu..."
                  : "Đang xử lý..."),
            );
            scheduleRender();
            continue;
          }

          if (event === "thinking" && data.text) {
            thinkingText =
              typeof data.text === "string" && data.text.startsWith(thinkingText)
                ? data.text.trim()
                : mergeAssistantText(thinkingText, data.text).trim();
            const tip =
              thinkingText.length > 160
                ? `${thinkingText.slice(0, 160)}…`
                : thinkingText;
            showActivity(ui, tip || "Đang phân tích...");
            continue;
          }

          if (event === "status" && data.message) {
            showActivity(ui, data.message);
            continue;
          }

          if (event === "tool") {
            toolsUsed = true;
            if (data.status === "running") {
              toolRunning++;
              updateTool(ui, data);
            } else {
              toolRunning = Math.max(0, toolRunning - 1);
              updateTool(ui, data);
              if (toolRunning === 0) onToolsIdle(ui);
            }
            continue;
          }

          if (event === "error") {
            streamFailed = true;
            showAssistant(ui);
            markReceived(ui);
            ui.assistant.classList.add("error");
            ui.copyText = data.message ?? "Unknown error";
            ui.body.textContent = ui.copyText;
            continue;
          }

          if (event === "done") {
            streamFinished = true;
            if (data.result) {
              finalResult = data.result;
              assistantText = data.result;
            }
            markReceived(ui);
            ui.assistant.classList.remove("pending");
            if (data.status === "error" || data.status === "cancelled") {
              streamFailed = true;
              ui.assistant.classList.add("error");
            }
            if (toolsUsed) collapseActivitySummary(ui);
            else dismissActivity(ui);
            showAssistant(ui, { keepActivity: toolsUsed });
            paintAssistant(assistantText || ui.copyText || "");
          }
        } catch (eventErr) {
          console.error("SSE event handler error:", event, eventErr);
          try {
            showActivity(ui, "Đang xử lý...");
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch (err) {
    streamFailed = true;
    showAssistant(ui);
    markReceived(ui);
    ui.assistant.classList.add("error");
    ui.copyText = err instanceof Error ? err.message : String(err);
    ui.body.textContent = ui.copyText;
  } finally {
    try {
      reader?.releaseLock?.();
    } catch {
      /* ignore */
    }
  }

  if (!streamFailed) {
    if (finalResult) assistantText = finalResult;

    if (assistantText) {
      if (!streamFinished) markReceived(ui);
      ui.assistant.classList.remove("pending");
      showAssistant(ui, { keepActivity: toolsUsed && Boolean(ui.activity) });
      if (toolsUsed && ui.activity && !ui.activity.hidden) {
        collapseActivitySummary(ui);
      } else {
        dismissActivity(ui);
      }
      paintAssistant(assistantText);
    } else if (!ui.body.textContent) {
      showAssistant(ui);
      markReceived(ui);
      ui.copyText = "Không có nội dung trả lời.";
      ui.body.textContent = ui.copyText;
    }
  } else {
    dismissActivity(ui);
  }

  sendBtn.disabled = false;
  inputEl.focus();
  scrollToBottom(true);
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text || sendBtn.disabled) return;
  sendMessage(text);
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 140)}px`;
});

showWelcome();
loadHealth();
