export function normalizeGoogleClientId(value) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  return /^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(id) ? id : '';
}
