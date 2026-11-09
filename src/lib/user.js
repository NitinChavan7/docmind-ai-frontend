export function getUserInitials(name, email) {
  const words = typeof name === 'string' ? name.trim().split(/\s+/).filter(Boolean) : [];
  if (words.length) return [words[0], ...(words.length > 1 ? [words.at(-1)] : [])].map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
  return typeof email === 'string' && email ? Array.from(email)[0].toLocaleUpperCase() : 'ME';
}
