import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { BookOpen, LoaderCircle, CheckCircle2, Eye, EyeOff, ArrowRight, CircleHelp, X, FileText, ShieldCheck, MessageSquare } from 'lucide-react';
import * as auth from '../services/authApi.js';
import { resetCredentials } from '../services/http.js';
import GoogleMark from './GoogleMark.jsx';
import Modal from './Modal.jsx';
import { normalizeGoogleClientId } from '../lib/google.js';
import { friendlyError, validateAuthFields } from '../lib/errors.js';

const GoogleSignIn = lazy(() => import('./GoogleSignIn.jsx'));
const configuredGoogleClientId = normalizeGoogleClientId(import.meta.env.VITE_GOOGLE_CLIENT_ID);
const authTabId = crypto.randomUUID();
function notify() {
  if (!globalThis.BroadcastChannel) return;
  const channel = new BroadcastChannel('docmind-auth');
  channel.postMessage({ type: 'changed', source: authTabId }); channel.close();
}

export default function AuthGate({ children }) {
  const [googleClientId, setGoogleClientId] = useState(configuredGoogleClientId);
  const [googleConfigLoading, setGoogleConfigLoading] = useState(true);
  const [user, setUser] = useState(null), [checking, setChecking] = useState(true);
  const [open, setOpen] = useState(false), [prompt, setPrompt] = useState({});
  const [mode, setMode] = useState('login'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(''), [email, setEmail] = useState('');
  const [registrationPending, setRegistrationPending] = useState(null);
  const [showPassword, setShowPassword] = useState(false), [accountExists, setAccountExists] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const form = useRef(null), userRef = useRef(null);
  const restoreController = useRef(null), generation = useRef(0), authLock = useRef(false);
  const titleId = useId(), descriptionId = useId();
  userRef.current = user;

  const restore = useCallback(async () => {
    restoreController.current?.abort();
    const controller = new AbortController(); restoreController.current = controller;
    const current = ++generation.current;
    setChecking(true);
    try {
      const profile = await auth.getCurrentUser({ signal: controller.signal });
      if (current === generation.current) { setUser(profile); setOpen(false); }
    } catch (error) {
      if (!controller.signal.aborted && current === generation.current) setUser(null);
      // A new visitor without a session is a guest, not an authentication error.
    } finally { if (!controller.signal.aborted && current === generation.current) setChecking(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    auth.getAuthConfig({ signal: controller.signal }).then(config => {
      if (!controller.signal.aborted) setGoogleClientId(config.googleClientId);
    }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setGoogleConfigLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    restore();
    const expired = () => {
      if (!userRef.current) return;
      generation.current++; restoreController.current?.abort();
      resetCredentials(); setUser(null); setChecking(false);
      setMode('login'); setError('Please sign in again to continue. Your saved work is still in your account.');
      setPrompt({ reason: 'session' }); setOpen(true);
    };
    window.addEventListener('docmind-session-expired', expired);
    const channel = globalThis.BroadcastChannel ? new BroadcastChannel('docmind-auth') : null;
    if (channel) channel.onmessage = event => {
      if (event.data?.source === authTabId) return;
      resetCredentials(); setUser(null); restore();
    };
    return () => {
      generation.current++; restoreController.current?.abort();
      window.removeEventListener('docmind-session-expired', expired); channel?.close();
    };
  }, [restore]);

  useEffect(() => {
    if (open && success && mode === 'login' && !checking && !registrationPending) form.current?.elements.namedItem('password')?.focus();
  }, [open, success, mode, checking, registrationPending]);

  const requestSignIn = options => {
    setPrompt(options || {}); setMode(options?.mode || 'login');
    setError(''); setSuccess(''); setFieldErrors({}); setAccountExists(false); setShowPassword(false); setOpen(true);
  };
  const close = () => {
    if (authLock.current) return;
    setOpen(false); prompt.onCancel?.();
    setError(''); setFieldErrors({});
  };
  const finishRegistration = async registeredEmail => {
    try { await auth.logout(); } catch (error) { if (error.status !== 401) throw error; resetCredentials(); }
    setUser(null); setMode('login'); setEmail(registeredEmail);
    setRegistrationPending(null); setShowPassword(false);
    setSuccess('Your account is ready. Sign in to continue with your PDF.');
    notify();
  };
  const retryRegistrationFinish = async () => {
    if (authLock.current || !registrationPending) return;
    authLock.current = true; setBusy(true); setError('');
    try { await finishRegistration(registrationPending.email); }
    catch { setError('Your account is ready. Please try continuing to sign-in once more.'); }
    finally { authLock.current = false; setBusy(false); }
  };
  const authenticate = async (action, context, registrationEmail) => {
    if (authLock.current || checking) return;
    authLock.current = true; setBusy(true); setError(''); setSuccess(''); setAccountExists(false);
    let created = false;
    try {
      const profile = await action(); generation.current++; restoreController.current?.abort();
      if (registrationEmail) {
        created = true; setRegistrationPending({ email: registrationEmail });
        await finishRegistration(registrationEmail);
      } else {
        setUser(profile); setOpen(false); setMode('login'); setFieldErrors({}); notify();
      }
    } catch (error) {
      setAccountExists(!created && error.status === 409 && ['register', 'google'].includes(context));
      setError(created ? 'Your account was created. Please continue to sign-in below.' : friendlyError(error, context));
    } finally { authLock.current = false; setBusy(false); }
  };
  const signOut = async () => {
    if (authLock.current) return;
    authLock.current = true; setBusy(true);
    try {
      await auth.logout(); setEmail(userRef.current?.email || email); setShowPassword(false);
      setUser(null); setOpen(false); setMode('login'); setSuccess(''); notify();
    } finally { authLock.current = false; setBusy(false); }
  };
  const submit = event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = { name: data.get('name')?.trim(), email: data.get('email')?.trim(), password: data.get('password') };
    const errors = validateAuthFields(values, mode === 'register');
    setFieldErrors(errors); setError('');
    const first = Object.keys(errors)[0];
    if (first) { form.current?.elements.namedItem(first)?.focus(); return; }
    authenticate(() => mode === 'register' ? auth.register(values.name, values.email, values.password) : auth.login(values.email, values.password), mode, mode === 'register' ? values.email : undefined);
  };
  const clearField = name => setFieldErrors(previous => ({ ...previous, [name]: undefined }));
  const blocked = busy || checking;

  return <>
    {children(user, signOut, busy, requestSignIn, checking)}
    {open && !user && <Modal className="auth-dialog" role="dialog" labelledBy={titleId} describedBy={descriptionId} onClose={close} busy={busy}>
      <div className="auth-experience">
        <aside className="auth-story">
          <div className="auth-story-brand"><BookOpen size={23}/><strong>docmind</strong></div>
          <div className="auth-story-center"><div className="auth-story-art"><BookOpen size={48} strokeWidth={1}/><span aria-hidden="true">+</span></div><span className="eyebrow">YOUR DOCUMENT WORKSPACE</span><h2>Read documents.<br/><em>Check the details.</em></h2><p>Read PDFs, ask document-specific questions and review cited sources in one workspace.</p>
          {prompt.documentName && <div className="auth-document-context"><FileText size={18}/><div><small>SELECTED DOCUMENT</small><strong>{prompt.documentName}</strong></div><CheckCircle2 size={15}/></div>}
          </div>
          <div className="auth-story-footer"><ShieldCheck size={15}/><span>Your documents and saved conversations.</span></div>
        </aside>
        <section className="auth-form-panel">
          <div className="auth-form-top"><span>{prompt.reason === 'chat' ? 'CONTINUE YOUR CONVERSATION' : 'YOUR PERSONAL WORKSPACE'}</span><button data-autofocus className="tool-button" aria-label="Back to workspace" disabled={busy} onClick={close}><X size={18}/></button></div>
          {registrationPending ? <div className="registration-complete"><span className="registration-check"><CheckCircle2 size={27}/></span><h1 id={titleId}>Your account is ready.</h1><p id={descriptionId}>Select Continue to sign in to complete registration. Your document and question will be retained.</p>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} onClick={retryRegistrationFinish}>{busy ? <LoaderCircle size={16} className="spinner"/> : <ArrowRight size={16}/>}Continue to sign in</button></div> : <>
            <div className="auth-heading"><h1 id={titleId}>{mode === 'register' ? 'Create an account' : 'Sign in to DocMind'}</h1><p id={descriptionId}>{mode === 'register' ? 'Create an account to save documents and conversations.' : prompt.reason === 'chat' ? 'Sign in to submit your question. Your selected PDF and question will be retained.' : 'Access your saved documents and conversations.'}</p></div>
            {checking && <p className="auth-checking" role="status"><LoaderCircle size={13} className="spinner"/>Checking your session...</p>}
            {success && <div className="auth-success" role="status"><CheckCircle2 size={17}/><span>{success}</span></div>}
            {error && (accountExists ? <div className="auth-existing" role="alert"><CircleHelp size={19}/><div><strong>An account already exists.</strong><p>{error}</p><button type="button" onClick={() => { setMode('login'); setError(''); setAccountExists(false); setFieldErrors({}); setShowPassword(false); setSuccess('Use the sign-in method associated with your account.'); }}>Sign in instead <ArrowRight size={14}/></button></div></div> : <div className="auth-error" role="alert"><CircleHelp size={16}/><span>{error}</span></div>)}
            {googleClientId ? <Suspense fallback={<p className="auth-checking" role="status">Loading Google sign-in...</p>}><GoogleSignIn clientId={googleClientId} busy={blocked} onCredential={credential => authenticate(() => auth.googleLogin(credential), 'google')} onError={() => setError('Google sign-in did not finish. Please try again, or continue with your email.')}/></Suspense> : <div className="google-sign-in-unavailable"><button className="google-placeholder" type="button" disabled><GoogleMark/>Continue with Google</button><p role="status">{googleConfigLoading ? 'Checking Google sign-in...' : 'Google is unavailable right now. You can use your email below.'}</p></div>}
            <div className="auth-divider"><span>or use your email</span></div>
            <form key={mode} ref={form} onSubmit={submit} noValidate>
              {mode === 'register' && <div className="auth-field"><label htmlFor="auth-name">Your name</label><input id="auth-name" name="name" placeholder="Enter your name" autoComplete="name" disabled={blocked} maxLength={100} aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'auth-name-error' : undefined} onChange={() => clearField('name')}/>{fieldErrors.name && <small id="auth-name-error" role="alert">{fieldErrors.name}</small>}</div>}
              <div className="auth-field"><label htmlFor="auth-email">Email address</label><input id="auth-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" defaultValue={email} disabled={blocked} maxLength={254} aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined} onChange={event => { setEmail(event.target.value); clearField('email'); }}/>{fieldErrors.email && <small id="auth-email-error" role="alert">{fieldErrors.email}</small>}</div>
              <div className="auth-field"><label htmlFor="auth-password">Password</label><div className="auth-password"><input id="auth-password" name="password" placeholder={mode === 'register' ? 'Create a password' : 'Enter your password'} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} disabled={blocked} maxLength={72} aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined} onChange={() => clearField('password')}/><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} disabled={blocked} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>{fieldErrors.password ? <small id="auth-password-error" role="alert">{fieldErrors.password}</small> : mode === 'register' && <small className="auth-field-hint">Use at least 8 characters.</small>}</div>
              <button className="primary-button auth-submit" type="submit" disabled={blocked}>{busy ? <LoaderCircle className="spinner" size={16}/> : null}{busy ? mode === 'register' ? 'Creating your account...' : 'Signing you in...' : mode === 'register' ? 'Create account' : 'Sign in to continue'}{!busy && <ArrowRight size={16}/>}</button>
            </form>
            <p className="auth-mode-switch">{mode === 'login' ? 'New to DocMind?' : 'Already have an account?'} <button type="button" disabled={blocked} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setSuccess(''); setFieldErrors({}); setShowPassword(false); setAccountExists(false); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
            <div className="auth-reassurance"><MessageSquare size={13}/><span>Close this dialog to return to the workspace.</span></div>
          </>}
        </section>
      </div>
    </Modal>}
  </>;
}
