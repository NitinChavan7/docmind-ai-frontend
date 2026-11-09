const firstText = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim();

export const isAnswerPending = (pendingDocumentId, activeDocumentId) =>
  typeof pendingDocumentId === 'string' && pendingDocumentId.length > 0 && pendingDocumentId === activeDocumentId;

export function safeSourceUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Validate both fresh API citations and previously saved browser histories.
// Arbitrary API objects must never become React children.
export function normalizeSources(sources, documentId) {
  if (!Array.isArray(sources)) return [];
  return sources.filter(source => source && typeof source === 'object' && !Array.isArray(source)).map(source => {
    const document = source.document;
    const pageValue = source.pageNumber ?? source.page;
    const page = ['number', 'string'].includes(typeof pageValue) ? Number(pageValue) : NaN;
    const url = safeSourceUrl(source.url ?? source.link ?? source.href);
    return {
      documentId: url ? undefined : firstText(source.documentId, document?.documentId, document?._id, documentId),
      document: firstText(document, document?.originalName, document?.filename, document?.name, source.originalName, source.filename, source.title),
      ...(url ? { url } : {}),
      page: Number.isInteger(page) && page > 0 ? page : null,
      text: firstText(source.text, source.content) || '',
    };
  });
}

// Retrieval returns chunks; display one document with distinct page references.
export function groupSources(sources) {
  const documents = new Map();
  for (const source of sources) {
    const key = source.url || source.documentId || source.document || 'current-document';
    if (!documents.has(key)) documents.set(key, { ...source, pages: [] });
    const group = documents.get(key);
    if (source.page && !group.pages.includes(source.page)) group.pages.push(source.page);
  }
  return [...documents.values()].map(group => ({ ...group, pages: group.pages.sort((a, b) => a - b) }));
}

export function normalizeMessages(messages, documentId) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(message => message && typeof message.content === 'string' && ['user', 'assistant'].includes(message.role)).map((message, index) => {
    const value = message.timestamp ?? message.createdAt;
    const timestamp = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
    return {
      ...message,
      id: firstText(message.id, message._id) || `saved-message-${index}`,
      timestamp: Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15 ? timestamp : null,
      sources: normalizeSources(message.sources, documentId),
    };
  });
}
