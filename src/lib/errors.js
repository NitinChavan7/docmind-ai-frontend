// Translate transport/backend failures at the UI boundary. Keep server internals
// in the service layer, never in account forms, document notices or chat bubbles.
export function friendlyError(error, context = 'general') {
  const status = Number(error?.status);
  const streamErrors = {
    STREAM_EMPTY: 'No answer came through. Reload saved messages, then try your question again.',
    STREAM_INTERRUPTED: 'The connection dropped before the answer finished. This partial answer may not be saved. Reload saved messages to check.',
    STREAM_ERROR: 'The answer could not be finished. Any partial text is marked incomplete. Reload saved messages before trying again.',
    STREAM_PROTOCOL: 'We could not read the answer stream. Reload saved messages to check your conversation.',
    STREAM_UNCONFIRMED: 'Your answer arrived, but we could not confirm it was saved. Reload saved messages to check before asking again.',
  };
  if (streamErrors[error?.code]) return streamErrors[error.code];
  if (error?.code === 'REQUEST_TIMEOUT') return 'This is taking longer than expected. Please try again in a moment.';
  if (error?.code === 'SESSION_CHANGED') return 'Your account changed in another tab. Please try again.';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return "You're offline. Reconnect to the internet and try again.";
  if (status === 429) return "You've tried a few times in a row. Take a short break, then try again.";
  if (status === 413) return 'That PDF is too large. Please choose a file under 10 MB.';
  if (status === 401) {
    if (context === 'login') return "That email and password don't match. Check them and try again.";
    if (context === 'google') return 'Google sign-in did not finish. Please choose your account and try again.';
    return 'Please sign in again to continue. Your saved work is still in your account.';
  }
  if (status === 403) return 'We could not confirm access to this action. Refresh the page and try again.';
  if (status === 404) return 'This item is no longer available. Refresh your library to see the latest documents.';
  if (status === 409) {
    if (context === 'register' || context === 'google') return 'An account already uses this email. Sign in with your original method to continue.';
    return 'This document is finishing another task. Give it a moment, then try again.';
  }
  if (status === 400 && context === 'register') return 'Please check your name, email, and password, then try again.';
  if (status === 400 && context === 'upload') return 'We could not read that file as a PDF. Please choose another PDF.';
  if (status === 400 && context === 'chat') return 'Please shorten your question and try again.';
  const messages = {
    login: 'We could not sign you in just now. Please try again in a moment.',
    register: 'We could not create your account just now. Please try again in a moment.',
    google: 'We could not complete Google sign-in. Please try again or use your email.',
    logout: 'We could not sign you out just now. Please try again.',
    upload: 'Your PDF could not be saved just now. Your original file is safe. Please try again.',
    index: 'We could not prepare this PDF for questions. Please try again. You can still read it here.',
    documents: 'Your library could not be loaded just now. Please try again.',
    history: 'Your saved conversation could not be loaded. Please try again.',
    chat: 'We could not get an answer just now. Please try your question again.',
    pdf: 'We could not open this PDF just now. Please try loading it again.',
    delete: 'We could not remove this document just now. Please try again.',
    general: 'Something did not go as expected. Please try again in a moment.',
  };
  return messages[context] || messages.general;
}

export function validateAuthFields({ name, email, password }, registering) {
  const errors = {};
  if (registering && !name?.trim()) errors.name = 'What should we call you?';
  if (!email?.trim()) errors.email = 'Enter your email address to continue.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Use a complete email address, like you@example.com.';
  if (!password) errors.password = 'Enter your password to continue.';
  else if (registering && password.length < 8) errors.password = 'Choose a password with at least 8 characters.';
  else if (new TextEncoder().encode(password).length > 72) errors.password = 'Please use a shorter password. A few long words work well.';
  return errors;
}
