export interface ScopeCheckResult {
  allowed: boolean;
  reply?: string;
}

/** Core Sunflower Land topics. */
const TOPIC_PATTERNS: RegExp[] = [
  /\bsunflower\s*land\b/i,
  /\bsfl\b/i,
  /\bsfl\.world\b/i,
  /\bsunflower-land\b/i,
  /\bflower\s*token\b/i,
  /\bweb3\b/i,
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
  /\broadmap\b/i,
  /\blộ\s*trình\b/i,
  /\bkingdom\b/i,
  /\bisland\b/i,
  /\bquest(s)?\b/i,
  /\bevents?\b/i,
  /\bseasons?\b/i,
  /\bascension/i,
  /\bnpcs?\b/i,
  /\bplot\b/i,
  /\btimeline\b/i,
  /\b(craft(ing|ed)?|harvest|plant(ing|ed)?|mine|mining|fish(ing|ed)?|farm(ing|ed)?)\b/i,
  /\brecipe\b/i,
  /\bgrow\s*time\b/i,
  /\bfloor\s*price\b/i,
  /\b(gi[aá]|market|exchange|usd|t[yỷ]\s*gi[aá]|trad(e|ing))\b/i,
  /\bbi[eê]n\s*l[iợ]i\s*nhu[aậ]n\b/i,
  /\bsource\s*code\b/i,
  /\bgit\b/i,
  /\bchangelog\b/i,
  /\bcommits?\b/i,
  /\bpatch\s*notes?\b/i,
  /\b(repo(sitory)?|indexed\s*repo)\b/i,
  /\b(cập\s*nhật|cap\s*nhat|hôm\s*nay|hom\s*nay|mới\s*nhất|moi\s*nhat|thay\s*đổi|thay\s*doi)\b/i,
  /\b(iron|wood|stone|gold|sunflower|pumpkin|carrot|egg|honey|crimstone|obsidian|oil|barley|beetroot)\b/i,
  /\b(axe|pickaxe|rod|shovel|workbench|deliver(y|ies))\b/i,
  /\b(pet|pets|bud|buds|mutant|skill|skills|boost|buff)\b/i,
  /\b(megastore|auction|timeshard|genesis)\b/i,
  /\b(gỗ|sắt|đá|vàng|trứng|mật|dầu|bí|ngô|cà\s*rốt|lúa|mạ)\b/i,
  /\b(tài\s*nguyên|có\s*lời|mua\s*bán|công\s*thức|rìu|cuốc|cần\s*câu|xẻng)\b/i,
  /\bapi\b/i,
];

/** Follow-up / detail requests (short messages in an SFL chat). */
const FOLLOWUP_PATTERNS: RegExp[] = [
  /\b(chi\s*tiết|chi\s*tiet|toàn\s*bộ|toan\s*bo)\b/i,
  /\b(đào\s*sâu|dao\s*sau|rõ\s*hơn|ro\s*hon|cụ\s*thể|cu\s*the)\b/i,
  /\b(thêm|them|nữa|nua|tiếp\s*tục|tiep\s*tuc)\b/i,
  /\b(giúp\s*tôi|giup\s*toi|help\s*me)\b/i,
  /\b(more\s*detail|dig\s*deeper|elaborate|expand|continue)\b/i,
  /\b(lịch\s*trình|lich\s*trinh)\b/i,
];

const VIETNAMESE_TOPIC_PATTERNS: RegExp[] = [
  /\bgo\b/,
  /\bsat\b/,
  /\bvang\b/,
  /\btrung\b/,
  /\bmat\b/,
  /\bdau\b/,
  /\btai\s*nguyen\b/,
  /\bco\s*loi\b/,
  /\bmua\s*ban\b/,
  /\bcong\s*thuc\b/,
  /\bthu\s*hoach\b/,
  /\btrong\s*cay\b/,
  /\blo\s*trinh\b/,
  /\bcap\s*nhat\b/,
  /\bhom\s*nay\b/,
  /\bthay\s*doi\b/,
  /\bchi\s*tiet\b/,
  /\btoan\s*bo\b/,
  /\bdao\s*sau\b/,
];

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

const MAX_FOLLOWUP_LEN = 180;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  const normalized = normalize(text);
  return patterns.some((p) => p.test(text) || p.test(normalized));
}

function isFollowUpIntent(text: string): boolean {
  return text.trim().length <= MAX_FOLLOWUP_LEN && matchesAny(text, FOLLOWUP_PATTERNS);
}

function isVietnamese(text: string): boolean {
  return /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(
    text,
  );
}

export function offTopicReply(message: string): string {
  if (isVietnamese(message)) {
    return (
      "Mình chỉ hỗ trợ **Sunflower Land** — gameplay, roadmap/chapter, craft, giá tài nguyên/NFT, tỷ giá SFL, source code, git/changelog.\n\n" +
      "Ví dụ: *Roadmap chapter hiện tại?*, *Giá Iron?*, *Chi tiết roadmap*, *Hôm nay cập nhật gì?*"
    );
  }
  return (
    "I only answer **Sunflower Land** — gameplay, roadmap/chapters, prices, SFL rates, source code, git updates.\n\n" +
    "Try: *Full roadmap details?*, *Iron price?*, *What changed in git today?*"
  );
}

export function checkChatScope(message: string): ScopeCheckResult {
  const trimmed = message.trim();
  if (!trimmed) {
    return { allowed: false, reply: offTopicReply(message) };
  }

  const onTopic =
    matchesAny(trimmed, TOPIC_PATTERNS) ||
    matchesAny(normalize(trimmed), VIETNAMESE_TOPIC_PATTERNS);
  const followUp = isFollowUpIntent(trimmed);
  const offTopic = matchesAny(trimmed, BLOCK_PATTERNS);

  if (offTopic && !onTopic && !followUp) {
    return { allowed: false, reply: offTopicReply(trimmed) };
  }

  if (onTopic || followUp) {
    return { allowed: true };
  }

  return { allowed: false, reply: offTopicReply(trimmed) };
}
