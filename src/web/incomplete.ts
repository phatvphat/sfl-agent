/**
 * Detect agent replies that are only a progress/status line (no real answer).
 * Common failure: model says "Đang tra cứu..." then ends the turn without tools.
 */
export function looksLikeStatusPreamble(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length > 320) return false;

  const normalized = t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

  const statusStarts =
    /^(dang|looking|searching|checking|let me|i('ll| will)|toi se|minh se|de minh)\b/;
  const statusPhrases =
    /\b(dang\s+(tra\s*cuu|tim|xu\s*ly|soan|phan\s*tich)|tra\s*cuu|looking up|searching for|checking the)\b/;

  return statusStarts.test(normalized) || statusPhrases.test(normalized);
}

export const FOLLOWUP_COMPLETE_PROMPT = `Your previous reply was only a status/progress line and you did not finish answering.

Call the needed sfl_* tools now, then give a complete answer to the user's question.
Do not write another status-only message. Do not refuse if the question is about Sunflower Land.`;
