const configured = (import.meta.env?.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
export const API_BASE = configured.endsWith('/api') ? configured : configured + '/api';
let refreshPromise = null;
let csrfPromise = null;
let identityVersion = 0;
const publicPaths = new Set(['/auth/login', '/auth/register', '/auth/google', '/auth/refresh', '/auth/csrf', '/auth/config']);

export class ApiError extends Error {
  constructor(message, status = 0, code) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}
export const resetCredentials = () => { csrfPromise = null; identityVersion++; };

async function raw(path, options = {}) {
  const { timeoutMs = 30000, ...init } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetch(API_BASE + path, { ...init, signal, credentials: 'include' });
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason || error;
    if (timeout.aborted) throw new ApiError('The server took too long to respond. Please try again.', 0, 'REQUEST_TIMEOUT');
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the document server. Check that it is running and allows requests from this frontend.');
  }
}
async function parse(response) {
  const body = await response.text();
  let result;
  try { result = body ? JSON.parse(body) : null; }
  catch { throw new ApiError('The server returned an unexpected response (' + response.status + ').', response.status); }
  if (!response.ok || result?.success === false) {
    throw new ApiError(result?.message || (typeof result?.error === 'string' && result.error) || 'API request failed (' + response.status + ').', response.status, result?.code);
  }
  return result;
}
async function csrf() {
  if (!csrfPromise) {
    csrfPromise = raw('/auth/csrf').then(parse).then(result => {
      const token = result?.data?.csrfToken ?? result?.csrfToken;
      if (typeof token !== 'string' || !token) throw new ApiError('The server did not return a CSRF token.');
      return token;
    }).catch(error => { csrfPromise = null; throw error; });
  }
  return csrfPromise;
}
async function perform(path, options) {
  options.signal?.throwIfAborted();
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) headers.set('X-CSRF-Token', await csrf());
  options.signal?.throwIfAborted();
  return raw(path, { ...options, headers });
}
function sessionExpired() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('docmind-session-expired'));
}
async function refresh() {
  if (!refreshPromise) {
    const version = identityVersion;
    const action = async () => {
      // Another tab may already have rotated the shared HttpOnly cookies.
      if ((await raw('/auth/me')).ok) return;
      csrfPromise = null;
      await parse(await perform('/auth/refresh', { method: 'POST' }));
      if (version === identityVersion) csrfPromise = null;
    };
    refreshPromise = (globalThis.navigator?.locks
      ? navigator.locks.request('docmind-refresh', action) : action()
    ).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function responseFor(path, options = {}, retryAuth = true, retryCsrf = true) {
  const version = identityVersion;
  const response = await perform(path, options);
  options.signal?.throwIfAborted();
  if (version !== identityVersion) throw new ApiError('Your session changed. Please try again.', 0, 'SESSION_CHANGED');
  if (response.status === 401 && !publicPaths.has(path)) {
    if (!retryAuth) { sessionExpired(); return response; }
    try { await refresh(); }
    catch (error) { if (error.status === 401 && version === identityVersion) sessionExpired(); throw error; }
    options.signal?.throwIfAborted();
    if (version !== identityVersion) throw new ApiError('Your session changed. Please try again.', 0, 'SESSION_CHANGED');
    return responseFor(path, options, false, retryCsrf);
  }
  if (response.status === 403 && retryCsrf) {
    const data = await response.clone().json().catch(() => ({}));
    if (data.code === 'CSRF_INVALID') { csrfPromise = null; return responseFor(path, options, retryAuth, false); }
  }
  return response;
}
export async function request(path, options = {}) { return parse(await responseFor(path, options)); }
// Authentication/CSRF retries happen only on rejected HTTP headers, before the
// caller reads a body. A successful streaming response is never replayed.
export async function requestStream(path, options = {}) {
  const response = await responseFor(path, options);
  if (!response.ok) await parse(response);
  return response;
}
export async function fetchPrivatePdf(url, signal) {
  if (!url.startsWith(API_BASE + '/')) throw new ApiError('The PDF URL must belong to your configured API.');
  const response = await responseFor(url.slice(API_BASE.length), { signal, timeoutMs: 60000 });
  if (!response.ok) { await parse(response); throw new ApiError('Unable to open this PDF.', response.status); }
  const type = response.headers.get('Content-Type') || '';
  if (type && !type.includes('application/pdf') && !type.includes('application/octet-stream')) throw new ApiError('The server did not return a PDF file.');
  const blob = await response.blob();
  signal?.throwIfAborted();
  return blob;
}
export const unwrap = result => result?.data ?? result;
