export interface ScopeCheckResult {
  allowed: boolean;
  reply?: string;
}

/** Game-related signals — at least one required (unless message is clearly off-topic). */
const ALLOW_PATTERNS: RegExp[] = [
  /\bsunflower\s*land\b/i,
  /\bsfl\b/i,
  /\bflower\s*token\b/i,
  /\bbumpkin\b/i,
  /\bgoblin\b/i,
  /\bmarketplace\b/i,
  /\bp2p\b/i,
  /\bnft\b/i,
  /\bwearable/i,
  /\bcollectible/i,
  /\bhave_boost\b/i,
  /\bpolygon\b/i,
  /\bpol\b/i,
  /\bgems?\b/i,
  /\bcoins?\b/i,
  /\bchapter\b/i,
  /\bkingdom\b/i,
  /\bisland\b/i,
  /\bbumpkin\s*skills?\b/i,
  /\bcraft(ing|ed)?\b/i,
  /\bharvest/i,
  /\bplant(ing|ed)?\b/i,
  /\bmine|mining\b/i,
  /\bfish(ing|ed)?\b/i,
  /\bfarm(ing|ed)?\b/i,
  /\brecipe\b/i,
  /\bgrow\s*time\b/i,
  /\bfloor\s*price\b/i,
  /\bbi[eê]n\s*l[iợ]i\s*nhu[aậ]n\b/i,
  /\bt[yỷ]\s*gi[aá]\b/i,
  /\bgi[aá]\b/i,
  /\bmarket\b/i,
  /\bexchange\b/i,
  /\busd\b/i,
  /\bweb3\b/i,
  /\bsource\s*code\b/i,
  /\bsfl\.world\b/i,
  /\b(iron|wood|stone|gold|sunflower|pumpkin|carrot|egg|honey|crimstone|obsidian|oil|barley|beetroot)\b/i,
  /\b(axe|pickaxe|rod|shovel|workbench|deliver(y|ies))\b/i,
  /\b(pet|pets|bud|buds|mutant|skill|skills|boost|buff)\b/i,
  /\b(megastore|auction|timeshard|genesis)\b/i,
  /\btrad(e|ing)\b/i,
  /\b(gỗ|sắt|đá|vàng|trứng|mật|dầu|bí|ngô|cà\s*rốt|lúa|mạ)\b/i,
  /\btài\s*nguyên\b/i,
  /\bcó\s*lời\b/i,
  /\bmua\s*bán\b/i,
  /\bcông\s*thức\b/i,
  /\b(rìu|cuốc|cần\s*câu|xẻng)\b/i,
];

/** Vietnamese game terms on accent-stripped text (e.g. gỗ → go, sắt → sat). */
const VIETNAMESE_ALLOW_PATTERNS: RegExp[] = [
  /\bgo\b/, // gỗ / wood
  /\bsat\b/, // sắt / iron
  /\bvang\b/, // vàng / gold
  /\btrung\b/, // trứng / egg
  /\bmat\b/, // mật / honey
  /\bdau\b/, // dầu / oil
  /\btai\s*nguyen\b/, // tài nguyên / resources
  /\bco\s*loi\b/, // có lời / profitable
  /\bmua\s*ban\b/, // mua bán / trading
  /\bcong\s*thuc\b/, // công thức / recipe
  /\bthu\s*hoach\b/, // thu hoạch / harvest
  /\btrong\s*cay\b/, // trồng cây / planting
];

/** Clear off-topic — block when matched and no allow signal. */
const BLOCK_PATTERNS: RegExp[] = [
  /\b(write|debug|fix|refactor)\s+(my\s+)?(code|script|app|program)\b/i,
  /\b(python|javascript|typescript|java|c\+\+|golang|ruby|php)\b/i,
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

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  const normalized = normalize(text);
  return patterns.some((p) => p.test(text) || p.test(normalized));
}

function matchesVietnameseGameTerms(text: string): boolean {
  return matchesAny(normalize(text), VIETNAMESE_ALLOW_PATTERNS);
}

function isVietnamese(text: string): boolean {
  return /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(
    text,
  );
}

export function offTopicReply(message: string): string {
  if (isVietnamese(message)) {
    return (
      "Mình chỉ hỗ trợ câu hỏi về **Sunflower Land** — gameplay, công thức craft, giá tài nguyên/NFT, tỷ giá SFL, source code game.\n\n" +
      "Vui lòng đặt câu hỏi trong phạm vi game (ví dụ: *Giá gỗ/wood?*, *Công thức rìu?*, *Trading iron có lời không?*)."
    );
  }
  return (
    "I only answer questions about **Sunflower Land** — gameplay, crafting, resource/NFT prices, SFL rates, and game source code.\n\n" +
    "Please ask something in scope (e.g. *Iron marketplace price?*, *Axe recipe?*, *SFL to USD?*)."
  );
}

/**
 * Server-side scope gate — blocks off-topic chat before calling Cursor agent.
 */
export function checkChatScope(message: string): ScopeCheckResult {
  const trimmed = message.trim();
  if (!trimmed) {
    return { allowed: false, reply: offTopicReply(message) };
  }

  const onTopic =
    matchesAny(trimmed, ALLOW_PATTERNS) || matchesVietnameseGameTerms(trimmed);
  const offTopic = matchesAny(trimmed, BLOCK_PATTERNS);

  if (offTopic && !onTopic) {
    return { allowed: false, reply: offTopicReply(trimmed) };
  }

  if (onTopic) {
    return { allowed: true };
  }

  return { allowed: false, reply: offTopicReply(trimmed) };
}
