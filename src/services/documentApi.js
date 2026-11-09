import { API_BASE, request, unwrap } from './http.js';

export const getDocumentFileUrl = id => `${API_BASE}/documents/${encodeURIComponent(id)}/view`;

export function normalizeDocument(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('The server returned an invalid document.');
  const id = raw.documentId || raw._id || raw.id;
  if (!id || typeof id !== 'string') throw new Error('The server did not return a document ID.');
  return {
    id,
    name: [raw.originalName, raw.name, raw.filename].find(value => typeof value === 'string' && value.trim()) || 'Untitled PDF',
    size: Number(raw.fileSize ?? raw.size) || 0,
    createdAt: Date.parse(raw.createdAt) || 0,
    status: typeof raw.status === 'string' ? raw.status.toLowerCase() : 'uploaded',
    pageCount: Number(raw.pageCount) || 0,
    fileUrl: getDocumentFileUrl(id),
    remote: true,
  };
}

export async function getDocuments(options) {
  const data = unwrap(await request('/documents', options));
  const documents = Array.isArray(data) ? data : data?.documents;
  if (!Array.isArray(documents)) throw new Error('The server returned an invalid document list.');
  return documents.map(normalizeDocument);
}

export async function uploadDocument(file, options = {}) {
  const body = new FormData();
  body.append('file', file);
  const data = unwrap(await request('/documents/upload', { ...options, method: 'POST', body }));
  return normalizeDocument({ originalName: file.name, fileSize: file.size, createdAt: new Date().toISOString(), ...data });
}

export async function getDocument(id, options = {}) {
  return normalizeDocument(unwrap(await request(`/documents/${encodeURIComponent(id)}`, options)));
}

export async function processDocument(id, options = {}) {
  return unwrap(await request(`/documents/${encodeURIComponent(id)}/process`, { timeoutMs: 600000, ...options, method: 'POST' }));
}

export const deleteDocument = id => request(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
