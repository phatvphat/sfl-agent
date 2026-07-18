export interface ScopeCheckResult {
  allowed: boolean;
  reply?: string;
}

/**
 * Soft gate: default allow. Only reject clearly off-topic requests.
 * Game topic coverage is left to the agent + MCP tools.
 */
const BLOCK_PATTERNS: RegExp[] = [
  /\b(write|debug|fix|refactor)\s+(my\s+)?(code|script|app|program)\b/i,
  /\b(python|javascript|typescript|java|c\+\+|golang|ruby|php)\b/i,
  /\b(lập\s*trình|lap\s*trinh|programming|coding)\b/i,
  /\b(homework|essay|thesis|assignment)\b/i,
  /\b(weather|forecast|temperature)\b/i,
  /\b(politics|election|president|government)\b/i,
  /\b(tell me a joke|make me laugh)\b/i,
  /\bwho (is|are|was|were)\b/i,
  /\bwhat is the capital\b/i,
  /\btranslate (this|the following)\b/i,
  /\b(dich|dịch)\s+(doan|đoạn|van|văn)\b/i,
  /\b(minecraft|fortnite|league of legends|genshin|valorant|roblox|pokemon)\b/i,
  /\b(bitcoin|ethereum|btc|eth)\b(?!.*\bsfl\b)/i,
  /\b(stock market|forex|nasdaq)\b/i,
  /\b(openai|chatgpt|claude|gemini)\b/i,
  /\b(làm bài|giải bài|toán lớp|văn mẫu)\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  const normalized = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return patterns.some((p) => p.test(text) || p.test(normalized));
}

function isVietnamese(text: string): boolean {
  return /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(
    text,
  );
}

export function offTopicReply(message: string): string {
  if (isVietnamese(message)) {
    return "Mình chỉ hỗ trợ câu hỏi về **Sunflower Land**. Câu này ngoài phạm vi — mình không trả lời.";
  }
  return "I only answer **Sunflower Land** questions. This is out of scope — I won't answer it.";
}

export function checkChatScope(message: string): ScopeCheckResult {
  const trimmed = message.trim();
  if (!trimmed) {
    return { allowed: false, reply: offTopicReply(message) };
  }

  if (matchesAny(trimmed, BLOCK_PATTERNS)) {
    return { allowed: false, reply: offTopicReply(trimmed) };
  }

  return { allowed: true };
}
