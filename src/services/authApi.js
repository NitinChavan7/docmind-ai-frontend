import { request, resetCredentials, unwrap, ApiError } from './http.js';
import { normalizeGoogleClientId } from '../lib/google.js';

function profile(result) {
  const data = unwrap(result);
  const user = data?.user ?? data;
  const id = user?.id || user?._id;
  if (typeof id !== 'string' || !id || typeof user?.name !== 'string' || typeof user?.email !== 'string') {
    throw new ApiError('The server returned an invalid user profile.');
  }
  return { ...user, id };
}
const authenticate = async (path, body) => {
  const user = profile(await request(path, { method: 'POST', body: JSON.stringify(body) }));
  resetCredentials();
  return user;
};
export const register = (name, email, password) => authenticate('/auth/register', { name, email, password });
export const login = (email, password) => authenticate('/auth/login', { email, password });
export const googleLogin = credential => {
  if (typeof credential !== 'string' || !credential.trim()) return Promise.reject(new ApiError('Google did not return a sign-in credential. Please try again.'));
  return authenticate('/auth/google', { credential });
};
export const getAuthConfig = async options => {
  const data = unwrap(await request('/auth/config', { timeoutMs: 10000, ...options }));
  return { googleClientId: normalizeGoogleClientId(data?.googleClientId) };
};
export const getCurrentUser = async options => profile(await request('/auth/me', options));
export const logout = async () => { await request('/auth/logout', { method: 'POST' }); resetCredentials(); };
