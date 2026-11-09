import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSSEParser, consumeSSE } from '../src/lib/sse.js';
import { createLiveAnswer } from '../src/lib/liveAnswer.js';
import { streamChatMessage } from '../src/services/chatApi.js';
import { resetCredentials, API_BASE } from '../src/services/http.js';
import { normalizeSources, safeSourceUrl, groupSources } from '../src/lib/chat.js';

const encoder = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const frame = (event, data) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const done = frame('done', { chatId: 'chat', messageId: 'answer', status: 'completed' });
function response(text) { return new Response(text, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }); }
function mockFetch(t, handle) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.credentials, 'include');
    if (url.endsWith('/auth/csrf')) return json({ data: { csrfToken: 'token' } });
    return handle(url.replace(API_BASE, ''), options);
  });
}
beforeEach(() => resetCredentials());

test('SSE parser handles every split of CRLF frames, multiline data and comments', () => {
  const input = ': heartbeat\r\nevent: token\r\ndata: {"text":\r\ndata: "hello"}\r\n\r\nevent: done\ndata: {}\n\n';
  for (let cut = 0; cut <= input.length; cut++) {
    const events = [], parser = createSSEParser(event => events.push(event));
    parser.push(input.slice(0, cut)); parser.push(input.slice(cut)); parser.finish();
    assert.deepEqual(events, [{ event: 'token', data: '{"text":\n"hello"}' }, { event: 'done', data: '{}' }]);
  }
});

test('SSE parser retains incomplete events until their blank line and discards unfinished EOF', () => {
  const events = [], parser = createSSEParser(event => events.push(event));
  parser.push('event: token\ndata: {"text":"a"}\n'); assert.equal(events.length, 0);
  parser.push('\n'); assert.equal(events.length, 1);
  parser.push('event: token\ndata: unfinished'); parser.finish(); assert.equal(events.length, 1);
});

test('stream decoding handles UTF-8 split one byte at a time without token duplication', async () => {
  const bytes = encoder.encode(frame('token', { text: 'नमस्ते 🌱' }) + frame('token', { text: ' again' }) + done);
  const events = [];
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  await consumeSSE(new Response(body), event => { events.push(event); if (event.event === 'done') return false; });
  assert.equal(events.filter(e => e.event === 'token').map(e => JSON.parse(e.data).text).join(''), 'नमस्ते 🌱 again');
});

test('tokens become visible before completion and the live bubble batches notifications', async () => {
  const live = createLiveAnswer(5), snapshots = [];
  live.subscribe(() => snapshots.push(live.getSnapshot()));
  live.append('Hello');
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].content, 'Hello');
  live.append(' '); live.append('world');
  assert.equal(live.getContent(), 'Hello world');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(snapshots.length, 2); assert.equal(snapshots[1].content, 'Hello world');
  assert.equal(snapshots[0].status, 'streaming');
  live.finish('completed'); assert.equal(live.getSnapshot().status, 'completed');
});

test('stopping or switching a live answer freezes it; late tokens cannot enter another bubble', () => {
  const old = createLiveAnswer(), next = createLiveAnswer();
  old.append('old partial'); old.finish('stopped');
  old.append(' late token'); old.stage('generating');
  next.append('new answer'); next.finish('completed');
  assert.equal(old.getSnapshot().content, 'old partial'); assert.equal(old.getSnapshot().status, 'stopped');
  assert.equal(next.getSnapshot().content, 'new answer');
});

test('unmount disposal clears queued notifications and rejects late tokens', async () => {
  const live = createLiveAnswer(5); let notifications = 0;
  live.subscribe(() => notifications++); live.append('first'); live.append('pending'); live.dispose(); live.append('late');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(notifications, 1); assert.equal(live.getContent(), 'firstpending');
});

test('a one-token answer is published immediately before terminal completion', () => {
  const live = createLiveAnswer(), snapshots = [];
  live.subscribe(() => snapshots.push(live.getSnapshot()));
  live.append('Short answer.');
  assert.equal(live.getSnapshot().content, 'Short answer.');
  assert.equal(live.getSnapshot().status, 'streaming');
  live.finish('completed');
  assert.deepEqual(snapshots.map(item => item.status), ['streaming', 'completed']);
});

test('coalesced token and done events reveal progressively before saved-message replacement', async t => {
  const answer = 'A buffered answer should still arrive visibly in small pieces. '.repeat(3);
  const live = createLiveAnswer(1, { smooth: true }), snapshots = [];
  live.subscribe(() => snapshots.push(live.getSnapshot().content));
  mockFetch(t, async () => response(frame('token', { text: answer.slice(0, 80) }) + frame('token', { text: answer.slice(80) }) + done));
  const result = await streamChatMessage('chat', 'Question?', { onEvent: event => {
    if (event.event === 'token') live.append(event.data.text);
    if (event.event === 'done') live.stage('finishing');
  } });
  assert.equal(result.status, 'completed');
  assert(live.getSnapshot().content.length > 0 && live.getSnapshot().content.length < answer.length);
  await live.complete();
  assert.equal(live.getSnapshot().content, answer);
  assert(snapshots.length > 3);
  for (let i = 1; i < snapshots.length; i++) assert(snapshots[i].startsWith(snapshots[i - 1]));
  live.finish('completed');
});

test('Stop freezes a queued reveal without flashing the remaining buffered answer', async () => {
  const live = createLiveAnswer(1, { smooth: true });
  live.append('Already received text that should not all flash onto the screen when stopped.');
  const visible = live.getSnapshot().content;
  const completion = live.complete(); live.finish('stopped');
  assert.equal(await completion, false);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(live.getSnapshot().content, visible);
  assert.equal(live.getSnapshot().status, 'stopped');
});

test('smooth reveal preserves emoji and disposal releases a pending completion', async () => {
  const live = createLiveAnswer(1, { smooth: true }), snapshots = [];
  live.subscribe(() => snapshots.push(live.getSnapshot().content));
  live.append('🌱🌱🌱🌱🌱🌱'); await live.complete();
  assert.equal(live.getSnapshot().content, '🌱🌱🌱🌱🌱🌱');
  assert(snapshots.every(text => !text.endsWith('\uD83C')));
  live.dispose();
  const next = createLiveAnswer(1, { smooth: true });
  next.append('A pending buffer on an unmounted conversation.');
  const pending = next.complete(); next.dispose();
  assert.equal(await pending, false);
});

test('stream POST shares cookies and CSRF, sends only supported fields, and handles each delta once', async t => {
  const events = [];
  mockFetch(t, async (path, options) => {
    assert.equal(path, '/chats/chat/stream'); assert.equal(options.method, 'POST');
    assert.equal(options.headers.get('X-CSRF-Token'), 'token');
    assert.equal(options.headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(options.body), { question: 'Question?' });
    return response(frame('status', { stage: 'retrieving' }) + frame('meta', { chatId: 'chat', messageId: 'answer', mode: 'document', sources: [{ page: 2 }] }) + frame('token', { text: 'same' }) + frame('token', { text: 'same' }) + done + frame('token', { text: 'ignored' }));
  });
  const result = await streamChatMessage('chat', 'Question?', { onEvent: event => events.push(event) });
  assert.equal(result.content, 'samesame'); assert.equal(result.messageId, 'answer'); assert.equal(result.mode, 'document');
  assert.deepEqual(events.map(e => e.event), ['open', 'status', 'meta', 'token', 'token', 'done']);
});

test('expired authentication refreshes before opening the stream, not after tokens', async t => {
  let refreshed = false, attempts = 0, refreshes = 0;
  mockFetch(t, async path => {
    if (path === '/auth/me') return json({ message: 'expired' }, 401);
    if (path === '/auth/refresh') { refreshed = true; refreshes++; return json({ success: true }); }
    attempts++; return refreshed ? response(frame('token', { text: 'Ready' }) + done) : json({ message: 'expired' }, 401);
  });
  const result = await streamChatMessage('chat', 'Question?');
  assert.equal(result.content, 'Ready'); assert.equal(refreshes, 1); assert.equal(attempts, 2);
});

test('only an unavailable route falls back to the idempotent non-stream endpoint', async t => {
  const paths = [];
  mockFetch(t, async (path, options) => {
    paths.push(path);
    if (path.endsWith('/stream')) return json({ message: 'Not found' }, 404);
    assert.deepEqual(JSON.parse(options.body), { question: 'Question?', requestId: 'stable-request' });
    return json({ data: { chatId: 'chat', userMessage: { _id: 'user', role: 'user', content: 'Question?' }, assistantMessage: { _id: 'answer', role: 'assistant', content: 'Saved answer' } } });
  });
  const result = await streamChatMessage('chat', 'Question?', { requestId: 'stable-request' });
  assert.equal(result.transport, 'fallback'); assert.deepEqual(paths, ['/chats/chat/stream', '/chats/chat/messages']);
});

test('Stop aborts a pending reader, releases it, and never starts a fallback', async t => {
  let cancelled = false, calls = 0;
  const controller = new AbortController();
  mockFetch(t, async () => {
    calls++;
    return new Response(new ReadableStream({ start(sink) { sink.enqueue(encoder.encode(frame('token', { text: 'partial' }))); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await assert.rejects(streamChatMessage('chat', 'Question?', { signal: controller.signal, onEvent: event => { if (event.event === 'token') controller.abort(); } }), error => error.name === 'AbortError');
  assert.equal(cancelled, true); assert.equal(calls, 1);
});

test('an interrupted or errored stream never retries or falls back', async t => {
  let calls = 0;
  mockFetch(t, async () => { calls++; return response(frame('token', { text: 'partial' })); });
  await assert.rejects(streamChatMessage('chat', 'Question?'), error => error.code === 'STREAM_INTERRUPTED'); assert.equal(calls, 1);
  mockFetch(t, async () => { calls++; return response(frame('token', { text: 'partial' }) + frame('error', { message: 'private provider error' })); });
  await assert.rejects(streamChatMessage('chat', 'Question?'), error => error.code === 'STREAM_ERROR'); assert.equal(calls, 2);
});

test('a network failure during body reads preserves the delta and never replays the POST', async t => {
  let reads = 0, calls = 0; const tokens = [];
  mockFetch(t, async () => {
    calls++;
    return new Response(new ReadableStream({ pull(sink) {
      if (reads++ === 0) sink.enqueue(encoder.encode(frame('token', { text: 'Visible partial' })));
      else sink.error(new TypeError('Network connection lost'));
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await assert.rejects(streamChatMessage('chat', 'Question?', { onEvent: event => { if (event.event === 'token') tokens.push(event.data.text); } }), error => error.code === 'STREAM_INTERRUPTED');
  assert.deepEqual(tokens, ['Visible partial']); assert.equal(calls, 1);
});

test('HTTP JSON failures are checked before reading a stream and keep their status', async t => {
  let calls = 0;
  mockFetch(t, async () => { calls++; return json({ message: 'Unavailable' }, 503); });
  await assert.rejects(streamChatMessage('chat', 'Question?'), error => error.status === 503); assert.equal(calls, 1);
});

test('empty answers, wrong chat IDs, bad event JSON, and non-SSE 200s fail explicitly', async t => {
  for (const [body, code] of [[done, 'STREAM_EMPTY'], [frame('meta', { chatId: 'other' }), 'STREAM_PROTOCOL'], ['event: token\ndata: broken\n\n', 'STREAM_PROTOCOL']]) {
    mockFetch(t, async () => response(body));
    await assert.rejects(streamChatMessage('chat', 'Question?'), error => error.code === code);
  }
  mockFetch(t, async () => json({ answer: 'Already processed' }));
  await assert.rejects(streamChatMessage('chat', 'Question?'), error => error.code === 'STREAM_PROTOCOL');
});

test('server cancellation and generation timeouts terminate cleanly without retries', async t => {
  mockFetch(t, async () => response(frame('token', { text: 'partial' }) + frame('cancelled', { status: 'cancelled' })));
  assert.equal((await streamChatMessage('chat', 'Question?')).status, 'cancelled');
  mockFetch(t, async () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'text/event-stream' } }));
  // Keep the event loop alive while AbortSignal.timeout (an unref'ed timer) fires.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(streamChatMessage('chat', 'Question?', { timeoutMs: 15 }), error => error.code === 'REQUEST_TIMEOUT'); }
  finally { clearTimeout(keepAlive); }
});

test('web source links allow only HTTP(S) and remain distinct from document citations', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,unsafe', '/relative', 'https://user:password@example.com']) assert.equal(safeSourceUrl(bad), null);
  const sources = normalizeSources([{ title: 'Web reference', url: 'https://example.com/reference' }, { document: 'PDF', page: 2 }], 'document');
  assert.equal(sources[0].url, 'https://example.com/reference'); assert.equal(sources[0].documentId, undefined);
  assert.equal(sources[1].documentId, 'document'); assert.equal(groupSources(sources).length, 2);
});
