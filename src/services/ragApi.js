import { request, unwrap } from './http.js';
import { normalizeSources } from '../lib/chat.js';

export async function askDocumentQuestion(documentId, question) {
  const data = unwrap(await request('/rag/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, question }),
  }));
  if (typeof data?.answer !== 'string' || !data.answer.trim()) {
    throw new Error('The server returned no answer. Please try again.');
  }
  return {
    answer: data.answer,
    sources: normalizeSources(data.sources, documentId),
  };
}
