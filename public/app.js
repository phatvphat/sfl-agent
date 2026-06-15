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

async function initSession(persistChatContext = false) {
  if (persistChatContext) {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) {
      sessionId = existing;
      return;
    }
  } else {
    localStorage.removeItem(SESSION_KEY);
  }

  const res = await fetch("/api/session", { method: "POST" });
  const data = await res.json();
  sessionId = data.sessionId;

  if (persistChatContext) {
    localStorage.setItem(SESSION_KEY, sessionId);
  }
}

async function ensureSession() {
  if (sessionId) return sessionId;
  await initSession(false);
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

function resolveToolLabel(name, args) {
  if (name && name.startsWith("sfl_")) return name;
  if (!args || typeof args !== "object") return name === "mcp" ? null : name;

  const a = args;
  const candidates = [
    a.toolName,
    a.tool,
    a.name,
    a.tool_name,
    a?.input?.tool,
    a?.input?.toolName,
    a?.params?.name,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && (c.startsWith("sfl_") || c.length > 2)) return c;
  }

  return name === "mcp" ? null : name;
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

function markReceived(ui, date = new Date()) {
  if (ui.receivedAt) return;
  ui.receivedAt = date;
  ui.assistantTime.hidden = false;
  ui.assistantTime.dateTime = date.toISOString();
  ui.assistantTime.textContent = `Nhận ${formatChatTime(date)}`;
}

function createTurn(userText) {
  const sentAt = new Date();
  const turn = document.createElement("div");
  turn.className = "turn";

  const userMsg = document.createElement("div");
  userMsg.className = "msg user";
  const userContent = document.createElement("div");
  userContent.className = "msg-content";
  userContent.textContent = userText;
  userMsg.append(userContent, createMsgTime("Gửi", sentAt));

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

  const assistant = document.createElement("div");
  assistant.className = "msg assistant";
  assistant.hidden = true;
  const body = document.createElement("div");
  body.className = "msg-body md-content";
  const assistantTime = createMsgTime("Nhận", sentAt);
  assistantTime.hidden = true;
  assistant.append(body, assistantTime);

  turn.append(userMsg, activity, assistant);
  chatEl.appendChild(turn);
  scrollToBottom(true);

  return {
    turn,
    activity,
    pills: activity.querySelector(".tool-pills"),
    activityText: activity.querySelector(".activity-text"),
    spinner: activity.querySelector(".spinner"),
    assistant,
    body,
    assistantTime,
    sentAt,
    receivedAt: null,
    toolCounts: new Map(),
    hasText: false,
    toolsFinished: false,
  };
}

function showActivity(ui, label) {
  ui.activity.hidden = false;
  if (label) ui.activityText.textContent = label;
}

function dismissActivity(ui) {
  if (ui.activity?.parentNode) {
    ui.activity.remove();
    ui.activity = null;
  }
}

function showAssistant(ui, options = {}) {
  const { keepActivity = false } = options;
  ui.hasText = true;
  if (!keepActivity) dismissActivity(ui);
  ui.assistant.hidden = false;
  ui.assistant.classList.remove("pending");
}

function updateTool(ui, { name, status, callId, label, args }) {
  const displayName = label || resolveToolLabel(name, args);
  if (!displayName) {
    if (status === "running") showActivity(ui, "Đang tra cứu...");
    return;
  }

  showActivity(ui, status === "running" ? "Đang tra cứu..." : "Đang tra cứu...");

  const key = displayName;
  const count = (ui.toolCounts.get(key) ?? 0) + (status === "running" ? 1 : 0);
  if (status === "running") ui.toolCounts.set(key, count);

  let pill = ui.pills.querySelector(`[data-tool="${CSS.escape(key)}"]`);
  if (!pill) {
    pill = document.createElement("span");
    pill.className = "tool-pill";
    pill.dataset.tool = key;
    pill.innerHTML = `<span class="icon">◌</span><span class="name"></span>`;
    ui.pills.appendChild(pill);
  }

  const runCount = ui.toolCounts.get(key) ?? 1;
  const suffix = runCount > 1 ? ` ×${runCount}` : "";
  pill.querySelector(".name").textContent = displayName + suffix;

  if (status === "running") {
    pill.className = "tool-pill running";
    pill.querySelector(".icon").textContent = "◌";
  } else {
    pill.className = "tool-pill done";
    pill.querySelector(".icon").textContent = "✓";
  }
}

function onToolsIdle(ui) {
  ui.toolsFinished = true;
  if (!ui.hasText && ui.activity) {
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
  ui.activityText.textContent = `Đã dùng: ${names}`;
  ui.spinner.hidden = true;
  ui.pills.hidden = true;
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
    if (data.agent?.warmed) parts.push("Agent warm");
    else parts.push("Agent cold");
    if (data.ollama) parts.push("Ollama OK");
    else parts.push("Ollama off");
    parts.push(`${(data.indexedRecords ?? 0).toLocaleString()} chunks`);

    statusText.textContent = parts.join(" · ");
    statusDot.className = `dot ${data.cursorApiKey ? "ok" : "err"}`;
    await initSession(Boolean(data.agent?.persistChatContext));
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

  const scheduleRender = () => {
    if (renderTimer) return;
    renderTimer = requestAnimationFrame(() => {
      renderTimer = null;
      ui.body.innerHTML = renderMarkdown(assistantText);
      scrollToBottom();
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
      showAssistant(ui);
      markReceived(ui);
      ui.assistant.classList.add("error");
      ui.body.textContent = `Lỗi HTTP ${res.status}`;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block.split("\n");
        let event = "message";
        let dataLine = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) event = line.slice(7);
          if (line.startsWith("data: ")) dataLine = line.slice(6);
        }
        if (!dataLine) continue;

        let data;
        try {
          data = JSON.parse(dataLine);
        } catch {
          continue;
        }

        if (event === "text" && data.delta) {
          assistantText = mergeAssistantText(assistantText, data.delta);
          ui.assistant.hidden = false;
          ui.hasText = true;
          if (toolRunning > 0 || toolsUsed) {
            ui.assistant.classList.add("pending");
            showActivity(ui, thinkingText || "Đang tra cứu dữ liệu...");
          } else {
            ui.assistant.classList.remove("pending");
            dismissActivity(ui);
          }
          scheduleRender();
        }

        if (event === "thinking" && data.text) {
          thinkingText = mergeAssistantText(thinkingText, data.text).trim();
          if (toolRunning > 0 || !ui.hasText) {
            showActivity(ui, thinkingText || "Đang phân tích...");
          }
        }

        if (event === "status" && data.message) {
          showActivity(ui, data.message);
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
        }

        if (event === "error") {
          showAssistant(ui);
          markReceived(ui);
          ui.assistant.classList.add("error");
          ui.body.textContent = data.message ?? "Unknown error";
        }

        if (event === "done") {
          if (data.result) {
            finalResult = data.result;
            assistantText = data.result;
          }
          markReceived(ui);
          ui.assistant.classList.remove("pending");
          showAssistant(ui);
          scheduleRender();
        }
      }
    }
  } catch (err) {
    showAssistant(ui);
    markReceived(ui);
    ui.assistant.classList.add("error");
    ui.body.textContent = err instanceof Error ? err.message : String(err);
  }

  dismissActivity(ui);

  if (finalResult) {
    assistantText = finalResult;
  }

  if (assistantText) {
    markReceived(ui);
    showAssistant(ui);
    ui.body.innerHTML = renderMarkdown(assistantText);
  } else if (!ui.body.textContent) {
    showAssistant(ui);
    markReceived(ui);
    ui.body.textContent = "Không có nội dung trả lời.";
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
