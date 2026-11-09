import { request, unwrap, ApiError } from './http.js';
import { normalizeMessages } from '../lib/chat.js';
import { requestStream } from './http.js';
import { consumeSSE } from '../lib/sse.js';

function normalizeChat(raw, documentId) {
  const id = raw?._id || raw?.id;
  if (typeof id !== 'string' || !id) throw new ApiError('The server returned an invalid conversation.');
  const owner = typeof raw.documentId === 'string' ? raw.documentId : raw.documentId?._id;
  if (documentId && owner && owner !== documentId) throw new ApiError('This conversation belongs to another document.');
  return { ...raw, _id: id, title: typeof raw.title === 'string' ? raw.title : 'New conversation', documentId: owner || documentId };
}
export async function createChat(documentId, options = {}) {
  return normalizeChat(unwrap(await request('/chats', { ...options, method: 'POST', body: JSON.stringify({ documentId }) })), documentId);
}
export async function getCandidateChats(documentId, options = {}) {
  const data = unwrap(await request('/chats?documentId=' + encodeURIComponent(documentId), options));
  const items = Array.isArray(data) ? data : data?.chats;
  if (!Array.isArray(items)) throw new ApiError('The server returned an invalid conversation list.');
  return items.map(chat => normalizeChat(chat, documentId));
}
export async function getChatMessages(chatId, before, options = {}) {
  const result = await request('/chats/' + encodeURIComponent(chatId) + '/messages?limit=50' + (before ? '&before=' + encodeURIComponent(before) : ''), options);
  const data = unwrap(result);
  const messages = Array.isArray(data) ? data : data?.messages;
  if (!Array.isArray(messages)) throw new ApiError('The server returned an invalid message history.');
  const page = result?.pagination || data?.pagination;
  return { data: normalizeMessages(messages), pagination: { hasMore: page?.hasMore === true, before: page?.before || page?.nextCursor || null } };
}
export async function sendChatMessage(chatId, question, requestId, options = {}) {
  const data = unwrap(await request('/chats/' + encodeURIComponent(chatId) + '/messages', {
    timeoutMs: 180000, ...options, method: 'POST', body: JSON.stringify({ question, ...(requestId ? { requestId } : {}) }),
  }));
  if (data?.chatId && data.chatId !== chatId) throw new ApiError('The answer belongs to another conversation.');
  const [userMessage] = normalizeMessages([data?.userMessage]);
  const [assistantMessage] = normalizeMessages([data?.assistantMessage]);
  if (userMessage?.role !== 'user' || assistantMessage?.role !== 'assistant') throw new ApiError('The server returned an incomplete answer. Reload the saved conversation before retrying.');
  return { ...data, userMessage, assistantMessage };
}

export async function streamChatMessage(chatId, question, { signal, onEvent = () => {}, requestId, timeoutMs = 180000 } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const streamSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let text = '', meta = {}, terminal;
  try {
    let response;
    try {
      response = await requestStream('/chats/' + encodeURIComponent(chatId) + '/stream', {
        method: 'POST', signal: streamSignal, timeoutMs,
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        // There is no mode selector or stream requestId in the supplied contract.
        body: JSON.stringify({ question }),
      });
    } catch (error) {
      // Only an explicitly unavailable route may fall back. Never replay a 200
      // stream, a network failure, a model error, or an interrupted generation.
      if (![404, 405, 501].includes(error.status)) throw error;
      streamSignal.throwIfAborted();
      onEvent({ event: 'fallback', data: {} });
      return { transport: 'fallback', ...await sendChatMessage(chatId, question, requestId, { signal: streamSignal, timeoutMs }) };
    }
    if (!(response.headers.get('Content-Type') || '').toLowerCase().includes('text/event-stream')) {
      await response.body?.cancel().catch(() => {});
      throw new ApiError('The streaming endpoint did not return SSE.', 0, 'STREAM_PROTOCOL');
    }
    onEvent({ event: 'open', data: {} });
    await consumeSSE(response, frame => {
      if (!['status', 'meta', 'token', 'done', 'error', 'cancelled'].includes(frame.event)) return;
      let data;
      try { data = JSON.parse(frame.data); }
      catch { throw new ApiError('Invalid streaming event.', 0, 'STREAM_PROTOCOL'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('Invalid streaming payload.', 0, 'STREAM_PROTOCOL');
      if (data.chatId && data.chatId !== chatId) throw new ApiError('Stream belongs to another chat.', 0, 'STREAM_PROTOCOL');
      if (data.messageId && typeof data.messageId !== 'string') throw new ApiError('Invalid streaming message ID.', 0, 'STREAM_PROTOCOL');
      if (data.messageId && meta.messageId && data.messageId !== meta.messageId) throw new ApiError('Stream message ID changed.', 0, 'STREAM_PROTOCOL');
      if (frame.event === 'meta') meta = { ...meta, ...data };
      if (frame.event === 'token') {
        if (typeof data.text !== 'string') throw new ApiError('Invalid token delta.', 0, 'STREAM_PROTOCOL');
        text += data.text;
        if (text.length > 200000) throw new ApiError('Answer exceeds the streaming limit.', 0, 'STREAM_PROTOCOL');
      }
      if (frame.event === 'error') throw new ApiError(typeof data.message === 'string' ? data.message : 'Generation failed.', 0, 'STREAM_ERROR');
      if (frame.event === 'done') {
        if (data.status !== 'completed' || !data.messageId || data.chatId !== chatId) throw new ApiError('Incomplete done event.', 0, 'STREAM_PROTOCOL');
        if (!text.trim()) throw new ApiError('The model returned an empty answer.', 0, 'STREAM_EMPTY');
        terminal = { ...meta, ...data };
      }
      if (frame.event === 'cancelled') terminal = { ...meta, ...data, status: 'cancelled' };
      onEvent({ event: frame.event, data });
      if (terminal) return false;
    }, streamSignal);
    if (!terminal) throw new ApiError('The stream ended without completion.', 0, 'STREAM_INTERRUPTED');
    return { transport: 'stream', ...terminal, content: text };
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (timeout.aborted) throw new ApiError('Generation timed out.', 0, 'REQUEST_TIMEOUT');
    if (error instanceof ApiError) throw error;
    throw new ApiError('The connection ended while receiving the answer.', 0, 'STREAM_INTERRUPTED');
  }
}
