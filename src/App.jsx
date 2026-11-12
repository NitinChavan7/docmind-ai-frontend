import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, ArrowUpRight, ArrowRight, Info, X, FolderOpen, LogIn, BookOpen, MessageSquare, FileText } from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import GuestWelcome from './components/GuestWelcome.jsx';
import PDFSkeleton from './components/PDFSkeleton.jsx';
import AccountControls from './components/AccountControls.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import ChatErrorBoundary from './components/ChatErrorBoundary.jsx';
import WorkspaceDivider from './components/WorkspaceDivider.jsx';
import { listStoredDocuments, saveDocument, deleteStoredDocument, readChats, writeChats } from './lib/storage.js';
import { getDocuments, uploadDocument, processDocument, deleteDocument } from './services/documentApi.js';
import useDocumentChat from './hooks/useDocumentChat.js';
import useUsage from './hooks/useUsage.js';
import UsageDashboard from './components/UsageDashboard.jsx';
import UsagePolicyDialog from './components/UsagePolicyDialog.jsx';
import { uploadIssue, questionIssue, quotaMessage, QUOTA_CODES, isExpired, chatQuestionQuota } from './lib/usage.js';
import { isAnswerPending } from './lib/chat.js';
import { friendlyError } from './lib/errors.js';

const loadPDFViewer = () => import('./components/PDFViewer.jsx');
const PDFViewer = lazy(loadPDFViewer);
const USE_REAL_API = import.meta.env.VITE_USE_API !== 'false';
const uid = () => crypto.randomUUID();

export default function App({ user, onLogout, signingOut, onRequestSignIn, checkingSession }) {
  const authenticated = USE_REAL_API && Boolean(user);
  const guestMode = USE_REAL_API && !user;
  const userId = user?.id || null;
  const usageState = useUsage(authenticated ? userId : null);
  const usageData = usageState.available ? usageState.data : null;
  const usageReturnFocus = useRef(null), policyReturnFocus = useRef(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false), [quotaFailure, setQuotaFailure] = useState(null);
  const expiredSeen = useRef(new Set());
  useEffect(() => { setUsageOpen(false); setPolicyOpen(false); setQuotaFailure(null); expiredSeen.current.clear(); }, [userId]);
  useEffect(() => { setQuotaFailure(previous => ['CHAT_QUESTION_LIMIT_REACHED', 'CHAT_EXPIRED', 'DOCUMENT_EXPIRED'].includes(previous?.code) ? previous : null); }, [usageState.updatedAt]);
  const [docs, setDocs] = useState([]), [activeId, setActiveId] = useState(null);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [chats, setChats] = useState(() => USE_REAL_API ? {} : readChats());
  const [collapsed, setCollapsed] = useState(false), [chatOpen, setChatOpen] = useState(() => !window.matchMedia('(max-width: 1279px)').matches), [mobileOpen, setMobileOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => Math.min(680, Math.max(520, Math.round(window.innerWidth * .32))));
  const [chatFocus, setChatFocus] = useState(false);
  const [sidebarProfileOpen, setSidebarProfileOpen] = useState(false);
  const [query, setQuery] = useState(''), [jumpPage, setJumpPage] = useState({ page: 0 });
  const [toast, setToast] = useState(''), [dragging, setDragging] = useState(false), [uploading, setUploading] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false), [loadError, setLoadError] = useState(''), [deletingId, setDeletingId] = useState(null);
  const [queuedQuestion, setQueuedQuestion] = useState(null), [transferDocId, setTransferDocId] = useState(null), [transferError, setTransferError] = useState('');
  const accountControls = useRef(null), inputRef = useRef(null), uploadLock = useRef(false), dragDepth = useRef(0);
  const processing = useRef(new Set()), deleting = useRef(new Set()), previousUser = useRef(userId);
  const transfers = useRef(new Map()), transferController = useRef(null), resuming = useRef(false);
  const docsRef = useRef(docs), removedIds = useRef(new Set());
  docsRef.current = docs;
  const visibleDocs = useMemo(() => docs.filter(doc => !USE_REAL_API || doc.guest || (authenticated && doc.ownerId === userId)), [docs, authenticated, userId]);
  const activeDoc = useMemo(() => (uploadPreview?.ownerId === userId ? uploadPreview : null) || visibleDocs.find(doc => doc.id === activeId) || null, [visibleDocs, activeId, uploadPreview, userId]);
  const guestStart = guestMode && !activeDoc;
  const serverDocId = authenticated && activeDoc && !activeDoc.guest && !activeDoc.pendingUpload ? activeDoc.id : null;
  const reportQuota = error => {
    if (!QUOTA_CODES.has(error?.code)) return;
    setQuotaFailure({ code: error.code, details: error.details, documentId: activeId, chatId: serverChat.activeChatId }); usageState.refresh();
    if (error.code === 'DOCUMENT_EXPIRED') setDocs(previous => previous.map(doc => doc.id === activeId ? { ...doc, expiresAt: new Date().toISOString() } : doc));
  };
  const newChatIssue = () => !usageData ? { code: 'USAGE_UNAVAILABLE' } : isExpired(activeDoc) ? { code: 'DOCUMENT_EXPIRED' } : usageData.remaining.chats === 0 ? { code: 'CHAT_LIMIT_REACHED', details: { maxChats: usageData.limits.chats } } : null;
  const serverChat = useDocumentChat(serverDocId, Boolean(serverDocId), userId, {
    usage: usageData, usageUpdatedAt: usageState.updatedAt, onUsageChange: usageState.refresh, onError: reportQuota,
    beforeSend: chat => questionIssue(usageData, chat, activeDoc), beforeNewChat: newChatIssue,
  });
  const { pendingDocId, busyRef } = serverChat;
  const taskBusy = pendingDocId !== null || Boolean(transferDocId) || Boolean(uploadPreview);

  const loadDocuments = useCallback(async signal => {
    if (!userId) return;
    const presentAtStart = new Set(docsRef.current.map(doc => doc.id));
    setLoadingDocs(true); setLoadError('');
    try {
      const items = (await getDocuments({ signal })).filter(doc => !removedIds.current.has(doc.id)).map(doc => ({ ...doc, ownerId: userId }));
      if (signal?.aborted) return;
      items.sort((a, b) => b.createdAt - a.createdAt);
      setDocs(previous => {
        const byId = new Map(previous.map(doc => [doc.id, doc]));
        const newDuringRequest = previous.filter(doc => doc.ownerId === userId && !presentAtStart.has(doc.id) && !items.some(item => item.id === doc.id) && !removedIds.current.has(doc.id));
        return [...previous.filter(doc => doc.guest), ...newDuringRequest, ...items.map(doc => ({ ...doc, file: byId.get(doc.id)?.file }))];
      });
      setActiveId(previous => previous && (previous.startsWith('guest:') || !presentAtStart.has(previous) || items.some(doc => doc.id === previous)) ? previous : items[0]?.id || null);
    } catch (error) { if (error.name !== 'AbortError') setLoadError(friendlyError(error, 'documents')); }
    finally { if (!signal?.aborted) setLoadingDocs(false); }
  }, [userId]);

  useEffect(() => {
    if (!USE_REAL_API) return;
    if (authenticated) {
      const controller = new AbortController();
      loadDocuments(controller.signal);
      return () => controller.abort();
    }
    setDocs(previous => previous.filter(doc => doc.guest));
    setActiveId(previous => previous?.startsWith('guest:') ? previous : null);
    setLoadingDocs(false); setLoadError('');
  }, [authenticated, loadDocuments]);

  useEffect(() => {
    if (USE_REAL_API) return;
    let cancelled = false;
    (async () => {
      let stored = [];
      try { stored = await listStoredDocuments(); } catch { setToast('This browser could not restore your PDFs. You can choose them again.'); }
      stored.sort((a, b) => b.createdAt - a.createdAt);
      try {
        const response = await fetch('/sample-research.pdf');
        if (response.ok) {
          const file = new File([await response.blob()], 'The focused work field guide.pdf', { type: 'application/pdf' });
          stored.push({ id: 'docmind-sample', name: file.name, size: file.size, createdAt: 0, file, sample: true });
        }
      } catch {}
      if (!cancelled) { setDocs(stored); setActiveId(stored[0]?.id || null); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (previousUser.current && previousUser.current !== userId) {
      transferController.current?.abort(); transferController.current = null;
      transfers.current.clear(); resuming.current = false;
      removedIds.current.clear();
      setQueuedQuestion(null); setTransferDocId(null); setTransferError('');
    }
    previousUser.current = userId;
  }, [userId]);
  useEffect(() => () => transferController.current?.abort(), []);
  useEffect(() => { if (!USE_REAL_API) { try { writeChats(chats); } catch { setToast('Your conversation could not be saved in this browser.'); } } }, [chats]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer); }, [toast]);

  const indexDocument = async doc => {
    if (processing.current.has(doc.id) || deleting.current.has(doc.id)) return;
    if (isExpired(doc)) { reportQuota({ code: 'DOCUMENT_EXPIRED' }); return; }
    processing.current.add(doc.id);
    const update = fields => setDocs(previous => previous.map(item => item.id === doc.id ? { ...item, ...fields } : item));
    update({ status: 'processing', processingError: '' });
    try {
      const result = await processDocument(doc.id);
      update({ status: result?.status || 'ready', pageCount: result?.pageCount ?? doc.pageCount });
      setToast(doc.name + ' is ready for questions');
    } catch (error) {
      const message = friendlyError(error, 'index', usageData); reportQuota(error);
      update({ status: 'failed', processingError: message }); setToast(message);
    } finally { processing.current.delete(doc.id); }
  };

  const upload = async files => {
    if (uploadLock.current || busyRef.current || transferDocId || (authenticated && loadingDocs)) return;
    uploadLock.current = true; setUploading(true);
    loadPDFViewer().catch(() => {});
    try {
      for (const file of files) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setToast('Please choose a PDF. Other file types are not supported yet.'); continue; }
        if (!authenticated && file.size > (USE_REAL_API ? 10 : 20) * 1024 * 1024) { setToast('This PDF exceeds the size limit. Choose a file under ' + (USE_REAL_API ? 10 : 20) + ' MB.'); continue; }
        try {
          if (await file.slice(0, 5).text() !== '%PDF-') { setToast('That file does not look like a PDF. Please choose another PDF.'); continue; }
          let doc;
          if (authenticated) {
            setUploadPreview({ id: 'upload:' + uid(), name: file.name, file, ownerId: userId, pendingUpload: true, status: 'uploading' });
            setJumpPage({ page: 0 }); setMobileOpen(false);
            const latest = await usageState.refresh();
            const issue = uploadIssue(file, latest);
            if (issue) { setUploadPreview(null); setToast(friendlyError(issue, 'upload', latest)); continue; }
            doc = { ...await uploadDocument(file), file, ownerId: userId };
          }
          else {
            doc = { id: (guestMode ? 'guest:' : '') + uid(), name: file.name, size: file.size, createdAt: Date.now(), file, guest: guestMode, status: 'local' };
            if (!USE_REAL_API) await saveDocument(doc);
          }
          setDocs(previous => [doc, ...previous.filter(item => item.id !== doc.id)]);
          setActiveId(doc.id); setJumpPage({ page: 0 }); setMobileOpen(false); setTransferError('');
          setUploadPreview(null);
          if (guestMode) { setChatOpen(!window.matchMedia('(max-width: 1279px)').matches); setChatFocus(false); }
          setToast(guestMode ? 'PDF opened. Sign in to ask questions.' : 'Added ' + file.name + ' to your library');
          if (authenticated) { usageState.refresh(); await indexDocument(doc); }
        } catch (error) { setUploadPreview(null); reportQuota(error); setToast(friendlyError(error, 'upload', usageData)); if (authenticated) usageState.refresh(); }
      }
    } finally { uploadLock.current = false; setUploading(false); setUploadPreview(null); }
  };

  const deleteDoc = async doc => {
    if (processing.current.has(doc.id) || deleting.current.size || pendingDocId === doc.id || transferDocId === doc.id) return;
    if (!doc.guest && !window.confirm('Remove "' + doc.name + '" and its saved conversations?')) return;
    deleting.current.add(doc.id); setDeletingId(doc.id);
    try {
      if (doc.remote) { await deleteDocument(doc.id); await usageState.refresh(); }
      else if (!doc.guest) await deleteStoredDocument(doc.id);
      removedIds.current.add(doc.id);
      setDocs(previous => previous.filter(item => item.id !== doc.id));
      setChats(previous => { const next = { ...previous }; delete next[doc.id]; return next; });
      setActiveId(previous => previous === doc.id ? visibleDocs.find(item => item.id !== doc.id)?.id || null : previous);
      if (queuedQuestion?.docId === doc.id) setQueuedQuestion(null);
      setToast(doc.guest ? 'Removed from this preview. Your original file is unchanged.' : 'Document removed from your library.');
    } catch (error) { setToast(friendlyError(error, 'delete')); }
    finally { deleting.current.delete(doc.id); setDeletingId(null); }
  };

  const send = question => {
    question = question.trim();
    if (!activeDoc || activeDoc.pendingUpload || !question || busyRef.current || transferDocId || deleting.current.has(activeDoc.id)) return;
    if (USE_REAL_API && activeDoc.guest) {
      const request = { id: uid(), docId: activeDoc.id, question, phase: 'draft', resume: true };
      setQueuedQuestion(request); setTransferError('');
      if (!authenticated) onRequestSignIn?.({
        reason: 'chat', documentName: activeDoc.name,
        onCancel: () => setQueuedQuestion(previous => previous?.id === request.id ? { ...previous, resume: false } : previous),
      });
      return;
    }
    if (authenticated) {
      const issue = questionIssue(usageData, serverChat.activeConversation, activeDoc) || activeDenial;
      if (issue) { reportQuota(issue); return; }
      return serverChat.sendQuestion(question);
    }
    setChats(previous => ({ ...previous, [activeDoc.id]: [...(previous[activeDoc.id] || []),
      { id: uid(), timestamp: Date.now(), role: 'user', content: question },
      { id: uid(), timestamp: Date.now(), role: 'assistant', demo: true, content: 'This is an offline preview. Sign in to your connected workspace for answers from your documents.' },
    ] }));
  };

  useEffect(() => {
    if (!authenticated || !queuedQuestion?.resume || resuming.current) return;
    const request = queuedQuestion;
    const doc = visibleDocs.find(item => item.id === request.docId);
    if (request.phase === 'draft' && doc?.guest) {
      const controller = new AbortController(); transferController.current = controller;
      resuming.current = true; setTransferDocId(doc.id); setTransferError('');
      (async () => {
        try {
          const key = userId + ':' + doc.id;
          let remote = transfers.current.get(key);
          if (!remote) {
            const latest = await usageState.refresh();
            const issue = uploadIssue(doc.file, latest);
            if (issue) throw issue;
            remote = { ...await uploadDocument(doc.file, { signal: controller.signal }), ownerId: userId };
            transfers.current.set(key, remote);
            await usageState.refresh();
          }
          const result = await processDocument(remote.id, { signal: controller.signal });
          if (controller.signal.aborted) return;
          const ready = { ...remote, status: result?.status || 'ready', pageCount: result?.pageCount || 0, file: doc.file };
          setDocs(previous => [ready, ...previous.filter(item => item.id !== doc.id && item.id !== ready.id)]);
          setActiveId(ready.id); setJumpPage({ page: 0 });
          setQueuedQuestion(previous => previous?.id === request.id ? { ...previous, docId: ready.id, phase: 'ready' } : previous);
        } catch (error) {
          if (!controller.signal.aborted) {
            reportQuota(error); setTransferError(friendlyError(error, 'index', usageData));
            setQueuedQuestion(previous => previous?.id === request.id ? { ...previous, resume: false } : previous);
          }
        } finally {
          if (transferController.current === controller) { resuming.current = false; setTransferDocId(null); }
        }
      })();
    } else if (request.phase === 'ready' && activeId === request.docId && serverChat.historyReady) {
      resuming.current = true; setQueuedQuestion(previous => previous?.id === request.id ? { ...previous, phase: 'sending' } : previous);
      serverChat.sendQuestion(request.question).finally(() => {
        resuming.current = false; setQueuedQuestion(previous => previous?.id === request.id ? null : previous);
      });
    }
  }, [authenticated, queuedQuestion, visibleDocs, activeId, serverChat.historyReady, userId]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (viewport.scale === 1) document.documentElement.style.setProperty('--workspace-height', viewport.height + 'px');
      });
    };
    resize(); viewport.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener('resize', resize); document.documentElement.style.removeProperty('--workspace-height'); };
  }, []);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1280px)');
    const closeDrawer = event => { if (event.matches) setMobileOpen(false); };
    desktop.addEventListener('change', closeDrawer);
    return () => desktop.removeEventListener('change', closeDrawer);
  }, []);

  const uploadRestriction = authenticated ? uploadIssue(null, usageData) : null;
  const uploadReason = uploadRestriction ? friendlyError(uploadRestriction, 'upload', usageData) : '';
  const openUpload = () => { if (uploadRestriction) { setToast(uploadReason); return; } if (!uploadLock.current && !busyRef.current && !transferDocId) { loadPDFViewer().catch(() => {}); inputRef.current?.click(); } };
  const reload = () => { if (authenticated && !uploadLock.current && !busyRef.current && !processing.current.size && !deleting.current.size) loadDocuments(); };
  const signIn = () => onRequestSignIn?.({ reason: 'account' });
  const activeApi = authenticated && Boolean(activeDoc && !activeDoc.guest && !activeDoc.pendingUpload);
  const transferWaiting = Boolean(transferDocId && transferDocId === activeId);
  const activeExpired = activeApi && isExpired(activeDoc, usageState.now);
  const activeDenial = quotaFailure?.documentId === activeId && quotaFailure?.chatId === serverChat.activeChatId && ['DAILY_AI_LIMIT_REACHED', 'CHAT_QUESTION_LIMIT_REACHED', 'DOCUMENT_EXPIRED', 'CHAT_EXPIRED'].includes(quotaFailure.code) ? quotaFailure : null;
  const chatRestriction = activeApi ? questionIssue(usageData, serverChat.activeConversation, activeDoc, usageState.now) || activeDenial : null;
  const newChatReason = activeApi ? quotaMessage(newChatIssue(), usageData) : '';
  const currentQuota = chatQuestionQuota(serverChat.activeConversation);
  const remainingInChat = usageData && (currentQuota.remainingQuestions ?? (currentQuota.questionCount !== null ? Math.max(0, usageData.limits.questionsPerChat - currentQuota.questionCount) : null));

  useEffect(() => {
    if (!authenticated) return;
    let docsExpired = false, chatsExpired = false;
    for (const doc of visibleDocs) if (isExpired(doc, usageState.now) && !expiredSeen.current.has('doc:' + doc.id)) { expiredSeen.current.add('doc:' + doc.id); docsExpired = true; }
    for (const chat of serverChat.conversations) if (isExpired(chat, usageState.now) && !expiredSeen.current.has('chat:' + chat._id)) { expiredSeen.current.add('chat:' + chat._id); chatsExpired = true; }
    if (docsExpired) { loadDocuments(); usageState.refresh(); }
    if (chatsExpired) { serverChat.refreshConversations(); usageState.refresh(); }
  }, [authenticated, visibleDocs, serverChat.conversations, usageState.now, loadDocuments, usageState.refresh]);

  return <div className={`app-shell ${activeDoc ? 'has-document' : ''} ${guestStart ? 'guest-start' : ''} ${chatOpen ? 'is-asking' : 'is-reading'}`} onDragEnter={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth.current++; setDragging(true); } }} onDragOver={event => event.preventDefault()} onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); upload([...event.dataTransfer.files]); }}>
    <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={event => { upload([...event.target.files]); event.target.value = ''; }}/>
    {authenticated && policyOpen && <UsagePolicyDialog usageState={usageState} onClose={() => setPolicyOpen(false)} returnFocusRef={policyReturnFocus}/>}
    {!guestStart && <Sidebar usage={usageData} uploadReason={uploadReason} now={usageState.now} onPolicy={authenticated ? event => { policyReturnFocus.current = mobileOpen ? document.querySelector('[aria-label="Open navigation"]') : event.currentTarget; setMobileOpen(false); setUsageOpen(false); setPolicyOpen(true); } : undefined} user={user} guestMode={guestMode} onRequestSignIn={signIn} profileOpen={sidebarProfileOpen} onOpenProfile={user ? event => accountControls.current?.openProfile(event.currentTarget) : undefined} docs={visibleDocs} activeId={activeId} selectionLocked={Boolean(transferDocId)} onSelect={id => { if (transferDocId) return; if (id !== activeId) serverChat.cancelGeneration(); setActiveId(id); setJumpPage({ page: 0 }); setTransferError(''); }} onUpload={openUpload} onDelete={deleteDoc} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} query={query} onQuery={setQuery} chatCount={activeApi ? serverChat.messages.length : Object.values(chats).reduce((n, items) => n + items.length, 0)} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} apiMode={authenticated} uploading={uploading} loading={loadingDocs} loadError={loadError} onReload={reload} onProcess={indexDocument} deletingId={deletingId} pendingDocId={pendingDocId || transferDocId}/>}
    <main className="main-workspace">
      <header className="workspace-header"><div className="workspace-left">{guestStart ? <div className="guest-header-brand"><BookOpen size={23} strokeWidth={1.6}/><span>docmind<span className="guest-brand-mark">&reg;</span></span></div> : <><button className="tool-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={20}/></button><div className="breadcrumb"><FolderOpen size={16}/><span>Workspace</span><span className="crumb-sep">/</span><strong>Document studio</strong></div></>}</div><div className="workspace-right">{authenticated && <UsageDashboard usageState={usageState} open={usageOpen} returnFocusRef={usageReturnFocus} onOpen={event => { usageReturnFocus.current = event.currentTarget; setPolicyOpen(false); setUsageOpen(true); }} onClose={() => setUsageOpen(false)}/ >}{user && onLogout ? <AccountControls onProfileChange={setSidebarProfileOpen} ref={accountControls} user={user} onLogout={onLogout} signingOut={signingOut} disabled={taskBusy || uploading || !!deletingId || visibleDocs.some(doc => processing.current.has(doc.id))} documentCount={visibleDocs.filter(doc => !doc.guest).length} loadingDocuments={loadingDocs}/> : guestMode ? <button className="guest-sign-in" onClick={signIn}><LogIn size={14}/><span>Sign in</span><ArrowRight size={14}/></button> : <span className="header-avatar">ME</span>}</div></header>
      {guestStart ? <GuestWelcome onUpload={openUpload} uploading={uploading}/> : <>
      <div className="studio-heading"><div><div className="eyebrow">{guestMode ? 'PDF PREVIEW' : 'DOCUMENT LIBRARY'}</div><h1>Document <em>workspace</em></h1><p>{guestMode ? 'Preview your PDF, then sign in to ask questions.' : 'Upload PDFs, manage conversations and review source references.'}</p></div><button className="top-upload" disabled={uploading || loadingDocs || taskBusy || Boolean(uploadRestriction)} title={uploadReason} onClick={openUpload}>{uploading ? 'Adding your document...' : 'Add a document'}<ArrowUpRight size={16}/></button></div>
      <div className="studio-toolbar"><div className="studio-document"><span className="studio-document-icon"><FileText size={14}/></span><span title={activeDoc?.name}>{activeDoc?.name || 'Your document workspace'}</span>{activeDoc && <span className="document-state"><span className="status-dot"/>{activeDoc.guest ? 'Local preview' : activeDoc.status === 'processing' ? 'Preparing' : activeDoc.status === 'ready' ? 'Ready to ask' : 'PDF'}</span>}</div><div className="studio-toolbar-actions"><button className="studio-add-document" aria-label="Add a document" onClick={openUpload} disabled={uploading || loadingDocs || taskBusy || Boolean(uploadRestriction)} title={uploadReason}><FileText size={14}/><span>Add PDF</span></button><div className="view-switch" role="group" aria-label="Workspace view"><button aria-label="Read & ask" aria-pressed={chatOpen} onClick={() => { setChatFocus(false); setChatOpen(true); }}><MessageSquare size={13}/><span className="view-label-wide">Read & ask</span><span className="view-label-mobile">Ask</span></button><button aria-label="Read only" aria-pressed={!chatOpen} onClick={() => { setChatFocus(false); setChatOpen(false); }}><BookOpen size={13}/><span className="view-label-wide">Read only</span><span className="view-label-mobile">Read</span></button></div></div></div>
      <div className={`workspace-content ${chatOpen ? '' : 'reading-mode'} ${chatFocus ? 'chat-focused' : ''}`} style={{ '--assistant-width': chatWidth + 'px' }}>
        {chatOpen && <WorkspaceDivider width={chatWidth} onChange={setChatWidth}/>}
        <Suspense fallback={<PDFSkeleton reader name={activeDoc?.name}/>}><PDFViewer key={activeDoc?.id || 'empty'} doc={activeDoc} expired={activeExpired} onError={reportQuota} uploadReason={uploadReason} onUpload={openUpload} goToPage={jumpPage} apiMode={USE_REAL_API} guestMode={guestMode}/></Suspense>
        {chatOpen && <ChatErrorBoundary key={(userId || 'guest') + ':' + activeId}><ChatPanel usage={usageData} usageLoading={usageState.loading} onRefreshUsage={usageState.refresh} quotaReason={chatRestriction ? friendlyError(chatRestriction, 'chat', usageData) : ''} newChatReason={newChatReason} remainingInChat={remainingInChat} now={usageState.now} deletingChatId={serverChat.deletingChatId} deleteError={serverChat.deleteError} onDeleteChat={serverChat.removeConversation} expanded={chatFocus} onExpand={() => setChatFocus(value => !value)} doc={activeDoc} messages={activeApi ? serverChat.messages : chats[activeId] || []} guestMode={Boolean(activeDoc?.guest || guestMode)} conversations={serverChat.conversations} activeChatId={serverChat.activeChatId} onSelectChat={serverChat.selectConversation} onNewChat={serverChat.newConversation} historyLoading={activeApi && serverChat.historyLoading} historyError={activeApi ? serverChat.historyError : ''} onRetryHistory={serverChat.retryHistory} hasOlder={activeApi && serverChat.pagination?.hasMore && !!serverChat.pagination?.before} onLoadOlder={serverChat.loadOlder} sendError={transferError || (activeApi ? serverChat.sendError : '')} sendErrorAction={transferError ? 'retry' : serverChat.sendErrorAction} generation={activeApi ? serverChat.generation : null} transport={activeApi ? serverChat.transport : null} onStop={serverChat.stopGenerating} onRetrySend={transferError ? () => send(queuedQuestion?.question || '') : serverChat.retryQuestion} onSend={send} onClear={() => { if (activeApi) serverChat.newConversation(); else setChats(previous => ({ ...previous, [activeId]: [] })); }} onCitation={page => { setJumpPage({ page }); setChatFocus(false); if (window.matchMedia('(max-width: 1279px)').matches) setChatOpen(false); }} busy={taskBusy} waiting={isAnswerPending(pendingDocId, activeId) || transferWaiting} preparing={transferWaiting} restoreDraft={queuedQuestion && queuedQuestion.docId === activeId && !queuedQuestion.resume ? queuedQuestion : serverChat.rejectedDraft} unavailable={activeApi && (Boolean(chatRestriction) || activeDoc?.status !== 'ready' || deletingId === activeId || !serverChat.historyReady)} apiMode={activeApi}/></ChatErrorBoundary>}
      </div>
      <footer className="workspace-footer"><span><span className="status-dot"/>{guestMode ? 'Guest preview - Your PDF stays on this device until you sign in' : authenticated ? 'Private documents and saved conversations' : 'All files stored locally'}</span><span>DocMind AI <span className="footer-star" aria-hidden="true">*</span></span></footer>
      </>}
    </main>
    {dragging && <div className="drop-overlay"><FolderOpen size={40}/><h2>Upload PDF documents</h2><p>Drop your PDFs here - Up to {USE_REAL_API ? 10 : 20} MB each</p></div>}
    {toast && <div className="toast" role="status"><Info size={17}/>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15}/></button></div>}
  </div>;
}


