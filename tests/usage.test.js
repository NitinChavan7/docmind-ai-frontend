import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, uploadIssue, questionIssue, expiryLabel, isExpired, quotaMessage, formatReset, QUOTA_CODES } from '../src/lib/usage.js';
import { friendlyError } from '../src/lib/errors.js';
import { getUsage } from '../src/services/usageApi.js';
import { deleteChat, streamChatMessage } from '../src/services/chatApi.js';
import { resetCredentials } from '../src/services/http.js';
const MB = 1024 * 1024;
const fixture = () => ({ plan: 'free', limits: { pdfs: 5, pdfSizeBytes: 10 * MB, storageBytes: 50 * MB, pdfPages: 25, chats: 10, questionsPerChat: 50, dailyQuestions: 30, documentRetentionDays: 30, chatRetentionDays: 30 }, usage: { pdfs: 2, storageBytes: 12 * MB, chats: 3, dailyQuestions: 12 }, dailyResetAt: '2026-11-12T00:00:00.000Z' });
const pdf = size => ({ name: 'notes.pdf', type: 'application/pdf', size });
function mock(t, handler) {
  const previous = globalThis.fetch; resetCredentials();
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(options.credentials, 'include');
    if (url.endsWith('/auth/csrf')) return Response.json({ data: { csrfToken: 'token' } });
    return handler(url, options);
  };
  t.after(() => { globalThis.fetch = previous; resetCredentials(); });
}

test('usage counters and policy values come from the server, including changed limits and zero counts', () => {
  const data = fixture(); data.limits.pdfs = 7; data.usage.pdfs = 0;
  const usage = normalizeUsage(data);
  assert.equal(usage.remaining.pdfs, 7); assert.equal(usage.used.pdfs, 0);
  assert.equal(usage.remaining.dailyQuestions, 18); assert.equal(usage.dailyResetAt, data.dailyResetAt);
  assert.throws(() => normalizeUsage({}), /missing/);
  delete data.usage.chats; assert.throws(() => normalizeUsage(data), /missing/);
});
test('documented long-form API field aliases normalize without making up missing limits', () => {
  const usage = normalizeUsage({ limits: { maxDocuments: 5, maxFileSizeMB: 10, maxTotalStorageMB: 50, maxPdfPages: 25, maxChats: 10, maxQuestionsPerChat: 50, maxDailyQuestions: 30 }, usage: { documentCount: 1, totalStorageBytes: MB, activeChats: 2, questionsToday: 3 }, resetAt: '2026-11-12T00:00:00Z' });
  assert.equal(usage.limits.pdfSizeBytes, 10 * MB); assert.equal(usage.remaining.pdfs, 4);
  assert.equal(usage.limits.documentRetentionDays, null);
});
test('upload is allowed with room, blocked at five PDFs, above individual size, or without total storage', () => {
  const usage = normalizeUsage(fixture()); assert.equal(uploadIssue(pdf(MB), usage), null);
  assert.equal(uploadIssue(pdf(11 * MB), usage).code, 'PDF_SIZE_LIMIT_EXCEEDED');
  const full = fixture(); full.usage.pdfs = 5;
  assert.equal(uploadIssue(null, normalizeUsage(full)).code, 'PDF_COUNT_LIMIT_REACHED');
  const storage = fixture(); storage.usage.storageBytes = 49 * MB;
  assert.equal(uploadIssue(pdf(2 * MB), normalizeUsage(storage)).code, 'TOTAL_STORAGE_LIMIT_REACHED');
  assert.equal(uploadIssue({ name: 'notes.txt', type: 'text/plain', size: 10 }, usage).code, 'INVALID_PDF_FILE');
  assert.equal(uploadIssue(pdf(MB), null).code, 'USAGE_UNAVAILABLE');
});
test('page-limit and other quota messages use backend limits and never expose private error text', () => {
  const usage = normalizeUsage(fixture());
  assert.equal(friendlyError({ code: 'PDF_PAGE_LIMIT_EXCEEDED', message: 'secret stack trace' }, 'upload', usage), 'This PDF exceeds the 25-page limit. Please upload a shorter document.');
  for (const code of QUOTA_CODES) assert(!friendlyError({ code, message: 'PRIVATE_BACKEND_STACK' }, 'chat', usage).includes('PRIVATE_BACKEND_STACK'));
  assert.match(quotaMessage({ code: 'PDF_COUNT_LIMIT_REACHED' }, usage), /5 PDFs.*Delete/);
});
test('chat slots only block creating another chat; accepted question totals block a full existing chat', () => {
  const data = fixture(); data.usage.chats = 10; const usage = normalizeUsage(data);
  assert.equal(questionIssue(usage, null, {}).code, 'CHAT_LIMIT_REACHED');
  assert.equal(questionIssue(usage, { _id: 'chat', questionCount: 49 }, {}), null);
  assert.equal(questionIssue(usage, { _id: 'chat', questionCount: 50 }, {}).code, 'CHAT_QUESTION_LIMIT_REACHED');
  assert.equal(questionIssue(usage, { _id: 'chat', remainingQuestions: 0 }, {}).code, 'CHAT_QUESTION_LIMIT_REACHED');
});
test('daily exhaustion blocks an existing conversation and preserves the server reset timestamp', () => {
  const data = fixture(); data.usage.dailyQuestions = 30; data.dailyResetAt = '2026-11-12T03:14:00Z';
  const usage = normalizeUsage(data), issue = questionIssue(usage, { _id: 'chat' }, {});
  assert.equal(issue.code, 'DAILY_AI_LIMIT_REACHED'); assert.equal(issue.details.resetAt, data.dailyResetAt);
  assert.match(quotaMessage(issue, usage), /Questions reset/); assert.notEqual(formatReset(data.dailyResetAt), 'Reset time unavailable');
});
test('expiry timestamps block new operations, including exactly at expiry, while absent timestamps remain unknown', () => {
  const now = Date.parse('2026-11-11T12:00:00Z'), usage = normalizeUsage(fixture());
  const expired = { expiresAt: '2026-11-11T12:00:00Z' };
  assert(isExpired(expired, now)); assert(!isExpired({}, now)); assert.equal(expiryLabel(expired.expiresAt, now), 'Expired');
  assert.equal(questionIssue(usage, { _id: 'chat' }, expired, now).code, 'DOCUMENT_EXPIRED');
  assert.equal(questionIssue(usage, { _id: 'chat', ...expired }, {}, now).code, 'CHAT_EXPIRED');
  assert.equal(expiryLabel('invalid', now), '');
});
test('authenticated usage API uses the shared /api transport and validates the response', async t => {
  mock(t, async url => { assert(url.endsWith('/api/usage')); return Response.json({ success: true, data: fixture() }); });
  assert.equal((await getUsage()).remaining.dailyQuestions, 18);
});
test('HTTP quota errors keep structured details even when the preflight quota was stale', async t => {
  mock(t, async () => Response.json({ code: 'PDF_PAGE_LIMIT_EXCEEDED', message: 'private', details: { maxPages: 19 } }, { status: 400 }));
  await assert.rejects(getUsage(), error => error.code === 'PDF_PAGE_LIMIT_EXCEEDED' && friendlyError(error).includes('19-page'));
});
test('SSE quota errors preserve codes/details and never replay a generation', async t => {
  let calls = 0;
  mock(t, async () => { calls++; return new Response('event: error\ndata: ' + JSON.stringify({ code: 'DAILY_AI_LIMIT_REACHED', details: { resetAt: fixture().dailyResetAt }, message: 'private' }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } }); });
  await assert.rejects(streamChatMessage('chat', 'Question'), error => error.code === 'DAILY_AI_LIMIT_REACHED' && error.details.resetAt === fixture().dailyResetAt);
  assert.equal(calls, 1);
});
test('chat deletion uses credentials, CSRF and an encoded chat identifier', async t => {
  mock(t, async (url, options) => { assert(url.endsWith('/chats/chat%2Fid')); assert.equal(options.method, 'DELETE'); assert.equal(options.headers.get('X-CSRF-Token'), 'token'); return new Response(null, { status: 204 }); });
  await deleteChat('chat/id');
});

test('HTTP 429 quota rejection is not retried or sent to the non-stream fallback', async t => {
  let calls = 0;
  mock(t, async () => { calls++; return Response.json({ code: 'DAILY_AI_LIMIT_REACHED', details: { resetAt: fixture().dailyResetAt } }, { status: 429 }); });
  await assert.rejects(streamChatMessage('chat', 'Question'), error => error.status === 429 && error.code === 'DAILY_AI_LIMIT_REACHED');
  assert.equal(calls, 1);
});
