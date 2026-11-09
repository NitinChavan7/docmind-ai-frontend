// Only this bubble subscribes. Received text and visible text are separate so a
// burst of SSE frames (including done) still gets multiple browser paints.
export function createLiveAnswer(intervalMs = 16, { smooth = false } = {}) {
  let snapshot = { content: '', stage: 'understanding', status: 'streaming' };
  let content = '', visible = 0, timer = null, closed = false;
  const listeners = new Set(), waiters = new Set();
  const settle = value => { for (const resolve of waiters) resolve(value); waiters.clear(); };
  const emit = patch => {
    snapshot = { ...snapshot, content: content.slice(0, visible), ...patch };
    for (const listener of listeners) listener();
  };
  const advance = () => {
    const remaining = content.length - visible;
    let end = visible + (smooth ? Math.min(remaining, Math.max(3, Math.ceil(remaining / 40))) : remaining);
    // Never expose half of a UTF-16 surrogate pair while revealing a delta.
    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1]) && /[\uDC00-\uDFFF]/.test(content[end])) end++;
    visible = end; emit({});
  };
  const schedule = () => {
    if (closed || timer || visible === content.length) return;
    timer = setTimeout(() => {
      timer = null;
      if (closed) return;
      advance();
      if (visible === content.length) settle(true); else schedule();
    }, intervalMs);
  };
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    getContent: () => content,
    append(delta) {
      if (closed || !delta) return;
      const firstDelta = content.length === 0;
      content += delta;
      if (firstDelta) advance();
      schedule();
    },
    stage(stage) { if (!closed) emit({ stage }); },
    complete() {
      if (closed) return Promise.resolve(false);
      if (visible === content.length) return Promise.resolve(true);
      return new Promise(resolve => { waiters.add(resolve); schedule(); });
    },
    finish(status) {
      if (closed) return;
      clearTimeout(timer); timer = null;
      if (status === 'completed' || status === 'syncing') visible = content.length;
      emit({ status }); closed = true; settle(status === 'completed' || status === 'syncing');
    },
    dispose() { clearTimeout(timer); timer = null; closed = true; listeners.clear(); settle(false); },
  };
}
