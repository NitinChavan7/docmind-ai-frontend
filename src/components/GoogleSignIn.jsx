import { useEffect, useRef, useState } from 'react';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import GoogleMark from './GoogleMark.jsx';

function GoogleAttempt({ clientId, onCredential, onError, busy, onRetry }) {
  const [status, setStatus] = useState('loading');
  const [width, setWidth] = useState(300);
  const container = useRef(null);
  useEffect(() => {
    if (status !== 'loading') return;
    const timer = setTimeout(() => setStatus('failed'), 15000);
    return () => clearTimeout(timer);
  }, [status]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(200, Math.min(400, Math.floor(entries[0].contentRect.width)))));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  return <div className="google-auth-section" ref={container} aria-busy={busy}>
    <GoogleOAuthProvider clientId={clientId} onScriptLoadSuccess={() => setStatus('ready')} onScriptLoadError={() => setStatus('failed')}>
      {status === 'ready' ? <div className={'google-sign-in ' + (busy ? 'auth-busy' : '')} inert={busy}>
        <GoogleLogin text="continue_with" theme="outline" size="large" shape="rectangular" logo_alignment="left" width={width} useOneTap={false} auto_select={false} ux_mode="popup" onSuccess={result => {
          if (!busy) result.credential ? onCredential(result.credential) : onError();
        }} onError={onError}/>
      </div> : <div className="google-sign-in-unavailable">
        <button className="google-placeholder" type="button" disabled aria-describedby="google-sdk-status"><GoogleMark/>Continue with Google{status === 'loading' && <LoaderCircle className="spinner" size={14}/>}</button>
        {status === 'loading' ? <p id="google-sdk-status" role="status">Loading secure Google sign-in...</p> : <div id="google-sdk-status" className="google-sdk-error" role="alert"><p>Google sign-in could not load. Check your connection and try again.</p><button type="button" onClick={onRetry} disabled={busy}><RotateCcw size={12}/>Retry Google sign-in</button></div>}
      </div>}
    </GoogleOAuthProvider>
    {status === 'ready' && busy && <p className="google-auth-progress" role="status"><LoaderCircle size={12} className="spinner"/>Signing you in securely...</p>}
  </div>;
}

export default function GoogleSignIn(props) {
  const [attempt, setAttempt] = useState(0);
  return <GoogleAttempt key={attempt} {...props} onRetry={() => setAttempt(value => value + 1)}/>;
}
