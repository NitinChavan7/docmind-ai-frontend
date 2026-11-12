// All policy numbers originate from the API. Missing values are never treated as zero.
const number = (...values) => values.find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) ?? null;
const bytes = (direct, mb) => number(direct, typeof mb === 'number' ? mb * 1024 * 1024 : null);
export const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
export function normalizeUsage(data) {
  const l = data?.limits || {}, u = data?.usage || {};
  const limits = {
    pdfs: number(l.pdfs, l.maxPdfs, l.maxDocuments, data?.documents?.limit),
    storageBytes: bytes(number(l.storageBytes, l.maxStorageBytes, l.maxTotalStorageBytes, data?.storage?.limitBytes), number(l.maxTotalStorageMB, l.maxStorageMB)),
    pdfSizeBytes: bytes(number(l.pdfSizeBytes, l.maxPdfSizeBytes, l.maxFileSizeBytes), number(l.maxFileSizeMB, l.maxPdfSizeMB)),
    pdfPages: number(l.pdfPages, l.maxPdfPages, l.maxPagesPerPdf),
    chats: number(l.chats, l.maxChats, l.maxActiveChats, data?.chats?.limit),
    questionsPerChat: number(l.questionsPerChat, l.maxQuestionsPerChat),
    dailyQuestions: number(l.dailyQuestions, l.maxDailyQuestions, l.dailyQuestionLimit, data?.dailyQuestions?.limit),
    documentRetentionDays: number(l.documentRetentionDays, data?.retention?.documentDays),
    chatRetentionDays: number(l.chatRetentionDays, data?.retention?.chatDays),
  };
  const used = {
    pdfs: number(u.pdfs, u.documents, u.pdfCount, u.documentCount, data?.documents?.used),
    storageBytes: number(u.storageBytes, u.totalStorageBytes, u.usedStorageBytes, data?.storage?.usedBytes),
    chats: number(u.chats, u.chatCount, u.activeChats, data?.chats?.used),
    dailyQuestions: number(u.dailyQuestions, u.questionsToday, u.dailyQuestionsUsed, data?.dailyQuestions?.used),
  };
  if (Object.entries(limits).some(([key, value]) => !key.endsWith('RetentionDays') && value === null) || Object.values(used).some(value => value === null)) {
    throw Object.assign(new Error('The usage response is missing required limits or counters.'), { code: 'USAGE_UNAVAILABLE' });
  }
  return { plan: typeof data.plan === 'string' ? data.plan : 'free', limits, used,
    remaining: Object.fromEntries(Object.keys(used).map(key => [key, Math.max(0, limits[key] - used[key])])),
    dailyResetAt: validDate(data.dailyResetAt ?? data.resetAt ?? data.dailyQuestions?.resetAt ?? data.resetsAt),
  };
}
export const formatMB = value => value === null || value === undefined ? 'Unavailable' : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB`;
export const formatReset = value => validDate(value) ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Reset time unavailable';
export const isExpired = (item, now = Date.now()) => Boolean(validDate(item?.expiresAt) && Date.parse(item.expiresAt) <= now);
export function expiryLabel(value, now = Date.now()) {
  if (!validDate(value)) return '';
  if (Date.parse(value) <= now) return 'Expired';
  const expiry = new Date(value), today = new Date(now);
  const days = Math.round((Date.UTC(expiry.getFullYear(), expiry.getMonth(), expiry.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  return days === 0 ? 'Expires today' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
}
const issue = (code, details = {}) => ({ code, details });
export function uploadIssue(file, usage) {
  if (file && file.type !== 'application/pdf' && !file.name?.toLowerCase().endsWith('.pdf')) return issue('INVALID_PDF_FILE');
  if (!usage) return issue('USAGE_UNAVAILABLE');
  const l = usage.limits;
  if (file && file.size > l.pdfSizeBytes) return issue('PDF_SIZE_LIMIT_EXCEEDED', { maxFileSizeBytes: l.pdfSizeBytes });
  if (usage.remaining.pdfs === 0) return issue('PDF_COUNT_LIMIT_REACHED', { maxDocuments: l.pdfs });
  if (usage.remaining.storageBytes === 0 || (file && file.size > usage.remaining.storageBytes)) return issue('TOTAL_STORAGE_LIMIT_REACHED');
  return null;
}
export function chatQuestionQuota(raw) {
  return { questionCount: number(raw?.questionCount, raw?.acceptedQuestionCount, raw?.userQuestionCount), remainingQuestions: number(raw?.remainingQuestions, raw?.questionsRemaining) };
}
export function questionIssue(usage, chat, document, now = Date.now()) {
  if (isExpired(document, now)) return issue('DOCUMENT_EXPIRED');
  if (isExpired(chat, now)) return issue('CHAT_EXPIRED');
  if (!usage) return issue('USAGE_UNAVAILABLE');
  if (!usage.remaining.dailyQuestions) return issue('DAILY_AI_LIMIT_REACHED', { resetAt: usage.dailyResetAt });
  if (!chat?._id && !usage.remaining.chats) return issue('CHAT_LIMIT_REACHED', { maxChats: usage.limits.chats });
  const q = chatQuestionQuota(chat);
  if (q.remainingQuestions === 0 || (q.questionCount !== null && q.questionCount >= usage.limits.questionsPerChat)) return issue('CHAT_QUESTION_LIMIT_REACHED', { maxQuestionsPerChat: usage.limits.questionsPerChat });
  return null;
}
export const QUOTA_CODES = new Set(['PDF_COUNT_LIMIT_REACHED', 'PDF_SIZE_LIMIT_EXCEEDED', 'TOTAL_STORAGE_LIMIT_REACHED', 'PDF_PAGE_LIMIT_EXCEEDED', 'INVALID_PDF_FILE', 'CHAT_LIMIT_REACHED', 'CHAT_QUESTION_LIMIT_REACHED', 'DAILY_AI_LIMIT_REACHED', 'CHAT_RATE_LIMIT_REACHED', 'GENERATION_ALREADY_RUNNING', 'DOCUMENT_EXPIRED', 'CHAT_EXPIRED', 'USAGE_UNAVAILABLE']);
export function quotaMessage(error, usage) {
  if (!QUOTA_CODES.has(error?.code)) return null;
  const d = error.details || {}, l = usage?.limits || {};
  const count = (value, text) => typeof value === 'number' ? ` of ${value} ${text}` : '';
  switch (error.code) {
    case 'PDF_COUNT_LIMIT_REACHED': return `You have reached your limit${count(d.maxDocuments ?? d.maxPdfs ?? l.pdfs, 'PDFs')}. Delete an existing document to upload another.`;
    case 'PDF_SIZE_LIMIT_EXCEEDED': return `This PDF exceeds the ${formatMB(d.maxFileSizeBytes ?? (typeof d.maxFileSizeMB === 'number' ? d.maxFileSizeMB * 1024 * 1024 : l.pdfSizeBytes)).replace('Unavailable', 'individual file')} limit. Please upload a smaller document.`;
    case 'TOTAL_STORAGE_LIMIT_REACHED': return 'There is not enough storage for this PDF. Delete an existing document to free up space.';
    case 'PDF_PAGE_LIMIT_EXCEEDED': { const max = d.maxPages ?? d.maxPdfPages ?? l.pdfPages; return `This PDF exceeds the ${typeof max === 'number' ? max + '-page' : 'page'} limit. Please upload a shorter document.`; }
    case 'INVALID_PDF_FILE': return 'Please choose a valid PDF file. Other file types are not supported.';
    case 'CHAT_LIMIT_REACHED': return `You have reached your limit${count(d.maxChats ?? l.chats, 'conversations')}. Delete an existing conversation to create another.`;
    case 'CHAT_QUESTION_LIMIT_REACHED': return 'This conversation has reached its question limit. Start another chat if a conversation slot is available.';
    case 'DAILY_AI_LIMIT_REACHED': return `You have used your daily AI questions. ${validDate(d.resetAt ?? usage?.dailyResetAt) ? 'Questions reset ' + formatReset(d.resetAt ?? usage.dailyResetAt) + '.' : 'Refresh usage to check the reset time.'}`;
    case 'CHAT_RATE_LIMIT_REACHED': return 'You are sending questions too quickly. Wait a moment before trying again.';
    case 'GENERATION_ALREADY_RUNNING': return 'An answer is already being generated. Wait for it to finish or stop it before sending another question.';
    case 'DOCUMENT_EXPIRED': return 'This document has expired and cannot be used for new requests. Refresh your library or upload it again. Removal from storage is managed by the server.';
    case 'CHAT_EXPIRED': return 'This conversation has expired. You can read saved messages while available; start another chat to ask more questions.';
    case 'USAGE_UNAVAILABLE': return 'Usage limits are unavailable. Refresh usage before uploading or asking a new question. Your saved documents and messages remain readable.';
    default: return null;
  }
}
