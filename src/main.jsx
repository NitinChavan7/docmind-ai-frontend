import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './components/AuthGate.jsx';
import './styles/index.css';
import './styles/workspace.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {import.meta.env.VITE_USE_API === 'false' ? <App/> :
      <AuthGate>{(user, onLogout, signingOut, onRequestSignIn, checkingSession) =>
        <App user={user} onLogout={onLogout} signingOut={signingOut} onRequestSignIn={onRequestSignIn} checkingSession={checkingSession}/>
      }</AuthGate>}
  </React.StrictMode>,
);
