// Incremental SSE framing, independent of fetch and React. Retain a trailing CR
// until the next chunk so a split CRLF cannot introduce a false blank line.
export function createSSEParser(onEvent) {
  let buffer = '', event = '', data = [], size = 0;
  const line = value => {
    if (!value) {
      if (data.length) onEvent({ event: event || 'message', data: data.join('\n') });
      event = ''; data = []; size = 0;
      return;
    }
    size += value.length;
    if (size > 1024 * 1024) throw new Error('SSE frame exceeds the size limit');
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'event') event = content;
    if (field === 'data') data.push(content);
  };
  const drain = final => {
    let from = 0;
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] !== '\r' && buffer[i] !== '\n') continue;
      if (!final && buffer[i] === '\r' && i === buffer.length - 1) break;
      line(buffer.slice(from, i));
      if (buffer[i] === '\r' && buffer[i + 1] === '\n') i++;
      from = i + 1;
    }
    buffer = buffer.slice(from);
  };
  return {
    push(text) {
      buffer += text; drain(false);
      if (size + buffer.length > 1024 * 1024) throw new Error('SSE frame exceeds the size limit');
    },
    finish() { drain(true); buffer = ''; data = []; event = ''; },
  };
}

export async function consumeSSE(response, onEvent, signal) {
  signal?.throwIfAborted();
  if (!response.body?.getReader) throw new Error('Streaming response body is missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let terminal = false;
  const parser = createSSEParser(frame => {
    if (!terminal) terminal = onEvent(frame) === false;
  });
  const abort = () => { reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (!terminal) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) { parser.push(decoder.decode()); parser.finish(); break; }
      parser.push(decoder.decode(value, { stream: true }));
    }
    return terminal;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
