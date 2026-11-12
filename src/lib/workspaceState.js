// Remember navigation only. Authentication remains in the existing cookie session.
const keyFor = scope => `docmind-selected-document:${encodeURIComponent(scope)}`;

export function readSelectedDocument(scope) {
  if (!scope) return null;
  try { return sessionStorage.getItem(keyFor(scope)) || null; }
  catch { return null; }
}

export function rememberDocument(scope, id) {
  if (!scope || !id) return;
  try { sessionStorage.setItem(keyFor(scope), id); }
  catch { /* Navigation still works when browser storage is unavailable. */ }
}

export function chooseRememberedDocument(documents, scope) {
  const remembered = readSelectedDocument(scope);
  return documents.find(doc => doc.id === remembered)?.id || documents[0]?.id || null;
}
