import { createPortal } from 'react-dom';
import useAnchoredPanel from '../hooks/useAnchoredPanel.js';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { ChevronDown, X, Mail, ShieldCheck, FolderOpen, LogOut, ArrowRight, LoaderCircle, BookOpen } from 'lucide-react';
import Modal from './Modal.jsx';
import { getUserInitials } from '../lib/user.js';
import { friendlyError } from '../lib/errors.js';

const AccountControls = forwardRef(function AccountControls({ user, onLogout, disabled, signingOut, documentCount, loadingDocuments, onProfileChange }, ref) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const source = useRef(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const container = useRef(null), profileTrigger = useRef(null), panel = useRef(null), logoutTrigger = useRef(null), returnFocus = useRef(null), lock = useRef(false);
  const profileId = useId(), titleId = useId(), descriptionId = useId();
  const initials = getUserInitials(user.name, user.email);
  const pending = Boolean(confirming || signingOut);
  const openProfile = element => {
    const target = element || profileTrigger.current;
    const sameTrigger = source.current === target;
    setProfileOpen(value => sameTrigger ? !value : true);
    source.current = target; setAnchor(target);
  };
  useImperativeHandle(ref, () => ({ openProfile }), []);
  const sidebarAnchor = Boolean(anchor?.classList.contains('sidebar-profile'));
  const position = useAnchoredPanel(profileOpen, anchor, panel, sidebarAnchor ? 'top' : 'end');
  useEffect(() => { onProfileChange?.(profileOpen && sidebarAnchor); }, [profileOpen, sidebarAnchor, onProfileChange]);
  const closeProfile = () => { setProfileOpen(false); anchor?.focus({ preventScroll: true }); };

  useEffect(() => {
    if (!profileOpen) return;
    panel.current?.focus({ preventScroll: true });
    const dismiss = event => { if (!panel.current?.contains(event.target) && !anchor?.contains(event.target)) setProfileOpen(false); };
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); setProfileOpen(false); anchor?.focus({ preventScroll: true }); }
    };
    const focus = event => { if (!panel.current?.contains(event.target) && !anchor?.contains(event.target)) setProfileOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    document.addEventListener('focusin', focus);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key); document.removeEventListener('focusin', focus); };
  }, [profileOpen, anchor]);

  const requestLogout = source => {
    if (disabled || pending) return;
    returnFocus.current = source === 'profile' ? anchor : logoutTrigger.current;
    setProfileOpen(false); setError(''); setLogoutOpen(true);
  };
  const confirmLogout = async () => {
    if (lock.current || disabled || pending) return;
    lock.current = true; setConfirming(true); setError('');
    try { await onLogout(); }
    catch (error) { setError(friendlyError(error, 'logout')); }
    finally { lock.current = false; setConfirming(false); }
  };

  return <div className="account-controls" ref={container}>
    <button ref={profileTrigger} className={`profile-trigger ${profileOpen && !sidebarAnchor ? 'is-open' : ''}`} aria-label="Open your profile" aria-haspopup="dialog" aria-expanded={profileOpen && !sidebarAnchor} aria-controls={profileOpen ? profileId : undefined} onClick={event => openProfile(event.currentTarget)}>
      <span className="header-avatar">{initials}</span><span className="profile-trigger-copy"><strong>{user.name}</strong><small>Personal account</small></span><ChevronDown size={13}/>
    </button>
    <button ref={logoutTrigger} className="logout-button" aria-label="Sign out" disabled={disabled || pending} onClick={() => requestLogout('header')}><LogOut size={14}/><span>Sign out</span></button>

    {profileOpen && createPortal(<section ref={panel} id={profileId} className={`account-popover anchored-account ${sidebarAnchor ? 'from-sidebar' : 'from-header'}`} style={position} role="dialog" aria-label="Your account" tabIndex={-1}>
      <div className="account-popover-top"><span>YOUR ACCOUNT</span><button className="tool-button" aria-label="Close profile" onClick={closeProfile}><X size={15}/></button></div>
      <div className="account-identity"><span className="account-avatar">{initials}</span><h2>{user.name}</h2><p>{user.email}</p><span className="account-session"><span className="status-dot"/>Signed in</span></div>
      <dl className="account-details"><div><dt><Mail size={15}/>Email address</dt><dd>{user.email}</dd></div><div><dt><ShieldCheck size={15}/>Sign-in method</dt><dd>{user.provider === 'google' ? 'Google' : user.provider === 'local' ? 'Email & password' : 'Connected account'}</dd></div><div><dt><FolderOpen size={15}/>Your library</dt><dd>{loadingDocuments ? 'Loading documents...' : `${documentCount} ${documentCount === 1 ? 'document' : 'documents'}`}</dd></div></dl>
      <div className="account-popover-footer"><span>Your space to read, think, and explore.</span><button disabled={disabled || pending} onClick={() => requestLogout('profile')}><LogOut size={15}/>Sign out<ArrowRight size={14}/></button></div>
    </section>, document.body)}

    {logoutOpen && <Modal labelledBy={titleId} describedBy={descriptionId} busy={pending} onClose={() => setLogoutOpen(false)} returnFocusRef={returnFocus}>
      <div className="logout-card">
        <div className="logout-card-top"><span className="logout-brand"><BookOpen size={17}/>docmind</span><button className="tool-button" aria-label="Close sign-out confirmation" disabled={pending} onClick={() => setLogoutOpen(false)}><X size={17}/></button></div>
        <div className="logout-symbol"><LogOut size={25} strokeWidth={1.5}/></div>
        <span className="logout-eyebrow">UNTIL NEXT TIME</span>
        <h2 id={titleId}>Ready to sign out?</h2>
        <p id={descriptionId}>Your documents and saved conversations stay in your account. Pick up where you left off whenever you return.</p>
        <div className="logout-account"><span className="header-avatar">{initials}</span><span><strong>{user.name}</strong><small>{user.email}</small></span><ShieldCheck size={16}/></div>
        {error && <p className="logout-error" role="alert">{error}</p>}
        <div className="logout-actions"><button data-autofocus className="logout-cancel" disabled={pending} onClick={() => setLogoutOpen(false)}>Stay here</button><button className="logout-confirm" disabled={disabled || pending} onClick={confirmLogout}>{pending ? <LoaderCircle size={15} className="spinner"/> : <LogOut size={15}/ >}{pending ? 'Signing out...' : 'Yes, sign out'}</button></div>
      </div>
    </Modal>}
  </div>;
});

export default AccountControls;
