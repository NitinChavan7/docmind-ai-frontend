import { request, unwrap } from './http.js';
import { normalizeUsage } from '../lib/usage.js';
export const getUsage = async options => normalizeUsage(unwrap(await request('/usage', options)));
