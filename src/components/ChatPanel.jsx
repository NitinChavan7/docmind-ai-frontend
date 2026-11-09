import ConversationPicker from './ConversationPicker.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, ArrowUpRight, BookOpen, ScanText, ListFilter, Lightbulb,
  RotateCcw, FileText, ChevronRight, CircleHelp, LoaderCircle, Check, Copy, ArrowDown, ChevronDown,
} from 'lucide-react';
import { normalizeMessages, groupSources } from '../lib/chat.js';
import AnswerContent from './AnswerContent.jsx';
import { useCallback, useSyncExternalStore } from 'react';
import { Square, ExternalLink, Maximize2, Minimize2 } from 'lucide-react';

function CopyAnswer({ text }) {
  const [status, setStatus] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <div className="answer-actions"><button type="button" aria-label={status === 'Copied' ? 'Answer copied' : 'Copy answer'} onClick={async () => {
    try { await navigator.clipboard.writeText(text); setStatus('Copied'); }
    catch { setStatus('Select the answer text to copy it.'); }
    clearTimeout(timer.current); timer.current = setTimeout(() => setStatus(''), 2500);
  }}>{status === 'Copied' ? <Check size={13}/> : <Copy size={13}/>}<span>{status === 'Copied' ? 'Copied' : 'Copy answer'}</span></button><span className="copy-status" role="status">{status && status !== 'Copied' ? status : ''}</span></div>;
}

const examples = [
  { icon: ScanText, title: 'Give me the big picture', text: 'Summarize this document in a few key points', question: 'Summarize this document in a few key points.' },
  { icon: ListFilter, title: 'Find what matters', text: 'Pull out the key insights and takeaways', question: 'What are the key insights and takeaways?' },
  { icon: Lightbulb, title: 'Make it simpler', text: 'Explain the main ideas in plain English', question: 'Explain the main ideas in plain English.' },
];

const stageLabels = { understanding: 'Understanding your question...', retrieving: 'Searching your document...', searching_web: 'Searching the web...', generating: 'Generating your answer...', finishing: 'Finishing your answer...', saving: 'Checking saved conversation...' };

function LiveAssistant({ live, onProgress }) {
  const snapshot = useSyncExternalStore(live.subscribe, live.getSnapshot, live.getSnapshot);
  useEffect(() => { onProgress(); }, [snapshot.content, snapshot.status, onProgress]);
  return <div className="live-assistant">{snapshot.content ? <>
    <div className="stream-text" aria-live="off">{snapshot.content}{snapshot.status === 'streaming' && <span className="stream-caret" aria-hidden="true"/>}</div>
    {snapshot.status === 'streaming' && <span className="stream-stage" role="status"><LoaderCircle size={11} className="spinner"/>{stageLabels[snapshot.stage] || 'Preparing your answer...'}</span>}
  </> : snapshot.status === 'streaming' ? <AnswerProgress stage={snapshot.stage}/> : <span className="stream-stage">{snapshot.status === 'syncing' ? 'Checking saved conversation...' : 'No answer was received.'}</span>}</div>;
}

function AnswerProgress({ preparing, stage }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  return <div className="answer-progress">
    <div className="progress-brand" aria-hidden="true"><BookOpen size={17}/></div>
    <div className="progress-card">
      <div className="progress-heading">
        <span className="progress-title" role="status">{preparing ? 'Preparing your PDF' : stageLabels[stage] || 'Preparing your answer'}<span className="progress-dots" aria-hidden="true"><i/><i/><i/></span></span>
        <span className="progress-orbit" aria-hidden="true"/>
      </div>
      <p>{preparing ? 'Saving your document and getting it ready for questions. You can keep reading.' : elapsed >= 15 ? 'Still working. Some answers take a little more time.' : 'You can keep reading while DocMind responds.'}</p>
      <div className="progress-lines" aria-hidden="true"><span/><span/><span/></div>
      <div className="progress-footnote"><span><span className="status-dot"/>DOCMIND IS WORKING</span><time aria-hidden="true">{elapsed}s</time></div>
    </div>
  </div>;
}

export default function ChatPanel({ doc, messages, onSend, onClear, onCitation, busy, apiMode, waiting: requestWaiting, unavailable, conversations=[], activeChatId, onSelectChat, onNewChat, historyLoading, historyError, onRetryHistory, hasOlder, onLoadOlder, sendError, onRetrySend, guestMode, preparing, restoreDraft, generation, onStop, sendErrorAction, transport, expanded, onExpand }) {
  const waiting = Boolean(requestWaiting && busy && doc?.id);
  const [input, setInput] = useState('');
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const body = useRef(null);
  const composer = useRef(null);
  const followBottom = useRef(true);
  const firstScroll = useRef(true);
  const scrollAnchor = useRef(null);
  const safeMessages = useMemo(() => normalizeMessages(messages, doc?.id), [messages, doc?.id]);
  const tokenFrame = useRef(null);
  const onStreamProgress = useCallback(() => {
    cancelAnimationFrame(tokenFrame.current);
    tokenFrame.current = requestAnimationFrame(() => {
      if (body.current && followBottom.current && !scrollAnchor.current) body.current.scrollTo({ top: body.current.scrollHeight, behavior: 'instant' });
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(tokenFrame.current), []);

  useEffect(() => {
    // Scroll only the conversation, never the surrounding PDF or workspace.
    const frame = requestAnimationFrame(() => {
      if (!body.current) return;
      if (scrollAnchor.current) {
        const anchor = scrollAnchor.current;
        body.current.scrollTop = anchor.top + body.current.scrollHeight - anchor.height;
        scrollAnchor.current = null;
      } else if (followBottom.current) {
        body.current.scrollTo({ top: body.current.scrollHeight, behavior: firstScroll.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        firstScroll.current = false;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [safeMessages, waiting]);
  useEffect(() => { setInput(''); scrollAnchor.current = null; followBottom.current = true; firstScroll.current = true; setAwayFromBottom(false); }, [doc?.id, activeChatId]);
  useEffect(() => { if (historyError) scrollAnchor.current = null; }, [historyError]);
  useEffect(() => { if (restoreDraft?.question) setInput(restoreDraft.question); }, [restoreDraft?.id, restoreDraft?.resume]);
  useEffect(() => {
    if (!composer.current) return;
    composer.current.style.height = 'auto';
    composer.current.style.height = Math.min(128, Math.max(42, composer.current.scrollHeight)) + 'px';
  }, [input]);

  const submit = event => {
    event.preventDefault();
    const question = input.trim();
    if (!doc || !question || busy || unavailable) return;
    setInput('');
    followBottom.current = true;
    onSend(question);
  };

  return <aside className="chat-panel">
    <div className="chat-header">
      <div className="chat-heading"><span className="assistant-icon"><BookOpen size={18}/></span><div><strong>Document assistant</strong><small>{guestMode ? 'A little curiosity goes a long way' : apiMode ? 'Grounded in your document' : 'Your reading companion'}</small></div></div>
      <div className="chat-header-actions">{onExpand && <button className="tool-button expand-assistant" title={expanded ? 'Restore split view' : 'Expand assistant'} aria-label={expanded ? 'Restore split view' : 'Expand assistant'} aria-pressed={Boolean(expanded)} onClick={onExpand}>{expanded ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}</button>}<button className="tool-button" title={apiMode?'New conversation':'Clear conversation'} aria-label={apiMode?'New conversation':'Clear conversation'} disabled={!doc || preparing || historyLoading} onClick={onClear}><RotateCcw size={17}/></button></div>
    </div>
    {apiMode && doc && <ConversationPicker key={doc.id} conversations={conversations} activeChatId={activeChatId} loading={historyLoading} onSelect={onSelectChat} onNew={onNewChat}/>}
    {historyLoading && <div role="status" className="conversation-picker"><LoaderCircle size={14} className="spinner"/> Loading saved messages...</div>}
    {historyError && <div role="alert" className="conversation-error">{historyError} <button onClick={onRetryHistory}>Retry</button></div>}
    <div className="context-strip"><span className="status-dot"/><span>{doc ? '1 document in context' : 'No document selected'}</span><span className="context-mode">{guestMode ? 'GUEST' : apiMode ? 'CONNECTED' : 'PREVIEW'}</span></div>
    {apiMode && doc && doc.status !== 'ready' && <div className="chat-index-status" role="status">{doc.status === 'processing' ? 'Indexing your PDF. Questions will be available when it is ready.' : 'This document needs indexing. Use the control in your library to prepare it.'}</div>}
    <div className="chat-scroll-area"><div className="chat-body" ref={body} aria-busy={waiting || false} onScroll={event => {
      const node = event.currentTarget;
      const away = node.scrollHeight - node.scrollTop - node.clientHeight > 90;
      followBottom.current = !away; setAwayFromBottom(away);
    }}>
      {hasOlder && <button className="history-older" disabled={historyLoading||busy} onClick={() => { scrollAnchor.current = { height: body.current.scrollHeight, top: body.current.scrollTop }; onLoadOlder(); }}>Load older messages</button>}
      {safeMessages.length === 0 && !waiting && !historyLoading && !historyError ? <div className="chat-welcome">
        <div className="welcome-kicker">{doc ? 'A FRESH PERSPECTIVE' : 'READY WHEN YOU ARE'}</div>
        <div className="chat-welcome-icon"><BookOpen size={30} strokeWidth={1.3}/><span aria-hidden="true">✦</span></div>
        {doc ? <><h3>Less searching.<br/><em>More understanding.</em></h3><p>Your next insight is in the details.<br/>Start with a question, or try one below.</p></> : <><h3>A space for<br/><em>your next question.</em></h3><p>Upload a PDF to get started.<br/>Your answers and sources will appear here.</p></>}
        {doc && <div className="suggestions">{examples.map(({ icon: Icon, title, text, question }, index) =>
          <button key={title} disabled={!doc || busy || unavailable} onClick={() => { followBottom.current = true; onSend(question); }}>
            <span className={`prompt-icon prompt-${index}`}><Icon size={17}/></span><span><strong>{title}</strong><small>{text}</small></span><ArrowUpRight size={15}/>
          </button>
        )}</div>}
        <div className="chat-preview-note"><CircleHelp size={14}/>{!doc ? 'Choose a document, then ask at your own pace.' : guestMode ? 'Preview freely. Sign in when you send a question.' : apiMode ? 'Answers come from your selected document.' : 'Interactive preview. AI answers are not connected yet.'}</div>
      </div> : <div className="message-list" aria-live="polite">
        {safeMessages.map(message => <div key={message.id} className={`message ${message.role} ${message.isError ? 'message-error' : ''}`}>
          <span className="message-label">{message.role === 'assistant' && <BookOpen size={13}/ >}{message.role === 'user' ? 'YOU' : 'DOCMIND'}{message.demo && <span>DEMO</span>}{message.isError && <span>TRY AGAIN</span>}</span>
          <div className="message-bubble">{message.live?.subscribe ? <LiveAssistant live={message.live} onProgress={onStreamProgress}/> : message.role === 'assistant' ? <AnswerContent text={message.content}/> : message.content}</div>
          {message.delivery && message.delivery !== 'syncing' && <span className={`answer-delivery ${message.delivery}`} role="status">{message.delivery === 'stopped' ? 'Stopped' : message.delivery === 'failed' ? 'Incomplete answer' : 'Save not confirmed'}<span>{message.saved ? 'Saved version loaded' : 'Not confirmed saved · this text is only shown here'}</span></span>}
          {message.delivery === 'syncing' && <span className="stream-stage" role="status"><LoaderCircle size={11} className="spinner"/>Checking saved conversation...</span>}
          {message.sources.length > 0 && <details className="answer-sources" open><summary><FileText size={12}/><span>Sources you can explore</span><span className="source-count">{groupSources(message.sources).length}</span><ChevronDown size={13}/></summary><div className="source-list">{groupSources(message.sources).map((source, index) =>
            <div className="source-document" key={source.documentId || index}>
              {source.url ? <a className="source-document-name web-source" href={source.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13}/><span>{source.document || new URL(source.url).hostname}</span><ExternalLink size={11}/></a> : <><span className="source-document-name" title={source.document || doc?.name || 'Source'}><FileText size={13}/><span>{source.document || doc?.name || 'Source'}</span></span>
              <div className="source-pages">{source.pages.length ? source.pages.map(page => <button key={page} disabled={Boolean(source.documentId && source.documentId !== doc?.id)} onClick={() => onCitation(page)} title={'Open source page ' + page}>Page {page}<ChevronRight size={12}/></button>) : <span>Page unavailable</span>}</div></>}
            </div>
          )}</div></details>}
          <div className="message-meta">{message.role === 'assistant' && !message.live && message.content && <CopyAnswer text={message.content}/ >}{message.timestamp !== null && <span className="message-time">{message.role === 'user' && !message.optimistic && <Check size={10} aria-hidden="true"/>}{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}</div>
        </div>)}
        {waiting && preparing && <AnswerProgress preparing/>}
      </div>}
    </div>{awayFromBottom && <button className="jump-to-latest" onClick={() => { followBottom.current = true; body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'instant' }); setAwayFromBottom(false); }}><ArrowDown size={13}/>Latest messages</button>}</div>
    {sendError && <div className="conversation-error" role="alert"><span>{sendError}</span><button disabled={busy || historyLoading} onClick={onRetrySend}>{sendErrorAction === 'reload' ? 'Reload saved messages' : 'Retry question'}</button></div>}
    <div className="chat-footer">
      {transport === 'fallback' && !sendError && <p className="stream-fallback-note" role="status">{busy ? 'Live delivery is unavailable on this server. Your answer will appear when it is ready.' : 'This answer arrived in one piece. Live delivery is unavailable on this server.'}</p>}
      {waiting && generation && <div className="generation-control"><span role="status">{transport === 'stream' && generation.phase === 'generating' && <span className="live-response-badge"><span className="status-dot"/>LIVE</span>}<span>{stageLabels[generation.stage] || 'Preparing your answer...'}</span></span>{generation.phase === 'generating' && <button type="button" className="stop-generating" onClick={onStop}><Square size={10} fill="currentColor"/>Stop generating</button>}</div>}
      <form className={`chat-compose ${waiting ? 'is-waiting' : ''}`} onSubmit={submit}>
        <textarea ref={composer} aria-label="Question about your document" rows={2} placeholder={waiting ? 'Your answer is on its way...' : doc ? 'Ask anything about this document...' : 'Upload a PDF to get started...'} disabled={!doc || busy || unavailable} maxLength={4000} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); }
        }}/>
        <div className="compose-bottom">
          <span title={doc?.name}>{waiting ? <LoaderCircle size={12} className="spinner"/> : <FileText size={12}/ >}{preparing ? 'Getting your PDF ready' : waiting ? 'Generating answer' : doc ? 'Ask your document' : 'No document'}</span>
          <span className="compose-shortcut">{input.length > 3500 ? `${input.length}/4000` : '↵ to send'}</span>
          <button className={`send-button ${waiting ? 'is-pending' : ''}`} disabled={!doc || !input.trim() || busy || unavailable} aria-label={waiting ? 'Waiting for answer' : 'Send message'}>{waiting ? <LoaderCircle size={17} className="spinner"/> : <ArrowUp size={18}/>}</button>
        </div>
      </form>
      <p>{guestMode ? 'Your PDF stays on this device until you sign in.' : apiMode ? 'Check important details against the source.' : 'Frontend preview - Conversations stay in this browser'}</p>
    </div>
  </aside>;
}
