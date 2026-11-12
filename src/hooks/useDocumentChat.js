import { useCallback, useEffect, useRef, useState } from 'react';
import { createChat, deleteChat, getCandidateChats, getChatMessages, streamChatMessage } from '../services/chatApi.js';
import { ApiError } from '../services/http.js';
import { normalizeSources } from '../lib/chat.js';
import { createLiveAnswer } from '../lib/liveAnswer.js';
import { friendlyError } from '../lib/errors.js';
import { chatQuestionQuota, isExpired, QUOTA_CODES } from '../lib/usage.js';

const mergeMessages = (...groups) => [...new Map(groups.flat().map(message => [message.id, message])).values()];
const draftKey = id => 'draft:' + id;
const isAbort = error => error?.name === 'AbortError';
const EMPTY_MESSAGES = [];

export default function useDocumentChat(documentId, enabled, scopeId, options = {}) {
  const optionsRef = useRef(options); optionsRef.current = options;
  const [deletingChatId, setDeletingChatId] = useState(null), [deleteError, setDeleteError] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messagesByChat, setMessagesByChat] = useState({});
  const [pages, setPages] = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [sendError, setSendError] = useState('');
  const [dailyRejectionAt, setDailyRejectionAt] = useState(null);
  const [rejectedDraft, setRejectedDraft] = useState(null);
  const [sendErrorAction, setSendErrorAction] = useState('retry');
  const [pendingDocId, setPendingDocId] = useState(null);
  const [generation, setGeneration] = useState(null);
  const [transport, setTransport] = useState(null);
  const [readyDocumentId, setReadyDocumentId] = useState(null);
  const [stateScope, setStateScope] = useState(scopeId);
  const busyRef = useRef(false), runRef = useRef(null);
  const activeDocument = useRef(documentId), activeScope = useRef(scopeId), activeChat = useRef(null);
  const epoch = useRef(0), historyController = useRef(null), mounted = useRef(false);
  const cache = useRef(new Map()), messagesRef = useRef(messagesByChat);
  const retryTurn = useRef(null), failedQuestion = useRef('');
  activeDocument.current = documentId; activeScope.current = scopeId;
  messagesRef.current = messagesByChat;

  useEffect(() => {
    if (dailyRejectionAt && options.usageUpdatedAt >= dailyRejectionAt && options.usage?.remaining.dailyQuestions > 0) {
      setSendError(''); setDailyRejectionAt(null);
    }
  }, [dailyRejectionAt, options.usageUpdatedAt, options.usage?.remaining.dailyQuestions]);

  const current = run => mounted.current && runRef.current === run && activeDocument.current === run.documentId && activeScope.current === run.scopeId;
  const updateMessages = (run, update) => {
    if (!current(run)) return;
    const key = run.key;
    setMessagesByChat(previous => activeDocument.current === run.documentId && activeScope.current === run.scopeId
      ? { ...previous, [key]: update(previous[key] || []) } : previous);
  };
  const localAnswer = (run, delivery) => {
    run.live.finish(delivery);
    updateMessages(run, messages => messages.map(message => message.id === run.assistantId ? {
      ...message, live: undefined, content: run.live.getSnapshot().content, sources: run.sources,
      delivery, saved: false,
    } : message));
  };

  // Navigation invalidates the request synchronously; late events cannot affect
  // another chat even when a mocked/slow transport ignores its abort signal.
  const cancelGeneration = useCallback((reason = 'switch', notify = true) => {
    const run = runRef.current;
    if (!run) return;
    runRef.current = null;
    run.controller.abort(); run.reconcileController?.abort();
    if (reason === 'unmount') run.live.dispose(); else run.live.finish('stopped');
    cache.current.delete(run.documentId);
    busyRef.current = false;
    if (notify && mounted.current) {
      setPendingDocId(null); setGeneration(null);
      setMessagesByChat(previous => ({ ...previous, [run.key]: (previous[run.key] || []).map(message => message.id === run.assistantId
        ? { ...message, live: undefined, content: run.live.getSnapshot().content, sources: run.sources, delivery: 'stopped', saved: false } : message) }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; epoch.current++;
      historyController.current?.abort(); cancelGeneration('unmount', false);
    };
  }, [cancelGeneration]);

  const updateChatQuota = useCallback((id, raw = {}, quota = chatQuestionQuota(raw)) => {
    setConversations(previous => previous.map(chat => chat._id === id ? { ...chat,
      ...(typeof raw.expiresAt === 'string' ? { expiresAt: raw.expiresAt } : {}),
      ...(quota.questionCount !== null ? { questionCount: quota.inferred && typeof chat.questionCount === 'number' ? Math.max(chat.questionCount, quota.questionCount) : quota.questionCount } : {}),
      ...(quota.remainingQuestions !== null ? { remainingQuestions: quota.remainingQuestions } : {}),
    } : chat));
  }, []);

  const openHistory = useCallback(async (chatId, before, force = false) => {
    historyController.current?.abort();
    const revision = ++epoch.current, controller = new AbortController();
    historyController.current = controller; setHistoryError('');
    if (!force && !before && messagesRef.current[chatId]) { setHistoryLoading(false); setReadyDocumentId(activeDocument.current); return true; }
    setHistoryLoading(true);
    try {
      const result = await getChatMessages(chatId, before, { signal: controller.signal });
      if (!mounted.current || revision !== epoch.current) return false;
      setMessagesByChat(previous => ({ ...previous, [chatId]: before ? mergeMessages(result.data, previous[chatId] || []) : result.data }));
      setPages(previous => ({ ...previous, [chatId]: result.pagination }));
      const quota = { ...result.quota };
      if (!before && !result.pagination.hasMore && quota.questionCount == null) { quota.questionCount = result.data.filter(message => message.role === 'user').length; quota.inferred = true; }
      updateChatQuota(chatId, result.chat, quota);
      setReadyDocumentId(activeDocument.current);
      return true;
    } catch (error) {
      if (!isAbort(error) && revision === epoch.current && mounted.current) setHistoryError(friendlyError(error, 'history'));
      return false;
    } finally { if (revision === epoch.current && mounted.current) setHistoryLoading(false); }
  }, [updateChatQuota]);

  const loadConversations = useCallback(async (id, force = false) => {
    historyController.current?.abort();
    const revision = ++epoch.current, controller = new AbortController();
    historyController.current = controller; setHistoryLoading(true); setHistoryError('');
    try {
      const cached = cache.current.get(id);
      const items = !force && cached && Date.now() - cached.at < 30000
        ? cached.items : await getCandidateChats(id, { signal: controller.signal });
      if (!mounted.current || revision !== epoch.current) return;
      cache.current.set(id, { items, at: Date.now() }); setConversations(items);
      const chatId = items[0]?._id || null;
      activeChat.current = chatId; setActiveChatId(chatId);
      if (chatId) {
        const opened = await openHistory(chatId, undefined, force);
        if (opened && mounted.current && activeDocument.current === id) setReadyDocumentId(id);
      } else { setHistoryLoading(false); setReadyDocumentId(id); }
    } catch (error) {
      if (!isAbort(error) && revision === epoch.current && mounted.current) { setHistoryError(friendlyError(error, 'history')); setHistoryLoading(false); }
    }
  }, [openHistory]);

  useEffect(() => {
    cancelGeneration('scope'); historyController.current?.abort(); epoch.current++;
    cache.current.clear(); messagesRef.current = {};
    setMessagesByChat({}); setPages({}); setConversations([]); setActiveChatId(null);
    activeChat.current = null; busyRef.current = false; retryTurn.current = null;
    setPendingDocId(null); setGeneration(null); setTransport(null); setReadyDocumentId(null); setHistoryError(''); setSendError(''); setDailyRejectionAt(null); setRejectedDraft(null); setDeleteError(''); setDeletingChatId(null); setStateScope(scopeId);
  }, [scopeId, cancelGeneration]);

  useEffect(() => {
    cancelGeneration('document'); historyController.current?.abort(); epoch.current++;
    setConversations([]); setActiveChatId(null); activeChat.current = null; setReadyDocumentId(null);
    setHistoryError(''); setSendError(''); setDailyRejectionAt(null); setRejectedDraft(null); failedQuestion.current = ''; retryTurn.current = null;
    setTransport(null);
    if (enabled && documentId) loadConversations(documentId, true);
    else setHistoryLoading(false);
    return () => { historyController.current?.abort(); epoch.current++; cancelGeneration('document'); };
  }, [documentId, enabled, scopeId, loadConversations, cancelGeneration]);

  const selectConversation = id => {
    if (historyLoading) return;
    cancelGeneration('chat');
    activeChat.current = id || null; setActiveChatId(id || null);
    setSendError(''); setDailyRejectionAt(null); setRejectedDraft(null); failedQuestion.current = ''; retryTurn.current = null;
    setTransport(null);
    if (id) openHistory(id, undefined, true);
    else { historyController.current?.abort(); epoch.current++; setHistoryError(''); setHistoryLoading(false); }
  };
  const newConversation = () => {
    if (historyLoading) return;
    const issue = optionsRef.current.beforeNewChat?.();
    if (issue) { optionsRef.current.onError?.(issue); return; }
    selectConversation(null);
    setMessagesByChat(previous => ({ ...previous, [draftKey(documentId)]: [] }));
  };

  const reconcile = async (run, outcome) => {
    if (!run.chatId || !current(run)) return false;
    run.reconcileAttempted = true;
    run.reconcileController = new AbortController();
    const result = await getChatMessages(run.chatId, undefined, { signal: run.reconcileController.signal });
    if (!current(run)) return false;
    const quota = { ...result.quota };
    if (!result.pagination.hasMore && quota.questionCount == null) { quota.questionCount = result.data.filter(message => message.role === 'user').length; quota.inferred = true; }
    updateChatQuota(run.chatId, result.chat, quota);
    const answer = result.data.find(message => (message.id === run.messageId || (run.fallback && message.requestId === run.requestId)) && message.role === 'assistant' && message.content.trim());
    const answerIndex = answer ? result.data.indexOf(answer) : result.data.length;
    const question = result.data.slice(0, answerIndex).findLast(message => message.role === 'user' && message.content === run.question && !run.baselineIds.has(message.id));
    const confirmed = Boolean(answer && question);
    updateMessages(run, existing => {
      const base = existing.filter(message => message.id !== run.assistantId && !(question && message.id === run.userId));
      const persisted = result.data.map(message => message.id === answer?.id && (outcome !== 'completed' || !confirmed)
        ? { ...message, delivery: outcome === 'completed' ? 'unconfirmed' : outcome, saved: true } : message);
      const merged = mergeMessages(base, persisted);
      if (!answer && !run.rejectedQuota) merged.push({ id: run.assistantId, role: 'assistant', content: run.live.getSnapshot().content, sources: run.sources,
        timestamp: Date.now(), delivery: outcome === 'completed' ? 'unconfirmed' : outcome, saved: false });
      return merged;
    });
    // Preserve any older pages already loaded; update the cursor only for a new
    // conversation with no earlier cached page.
    setPages(previous => previous[run.chatId] ? previous : { ...previous, [run.chatId]: result.pagination });
    return confirmed;
  };

  const sendQuestion = async question => {
    if (!enabled || !documentId || readyDocumentId !== documentId || !question.trim() || question.length > 4000 || busyRef.current || historyLoading || historyError) return;
    const selected = conversations.find(chat => chat._id === activeChat.current);
    const issue = isExpired(selected) ? { code: 'CHAT_EXPIRED' } : optionsRef.current.beforeSend?.(selected);
    if (issue) { optionsRef.current.onError?.(issue); return; }
    busyRef.current = true; setRejectedDraft(null);
    const retry = retryTurn.current;
    const run = {
      documentId, scopeId, chatId: activeChat.current, key: activeChat.current || draftKey(documentId), question,
      userId: crypto.randomUUID(), assistantId: crypto.randomUUID(), controller: new AbortController(),
      live: createLiveAnswer(16), sources: [], stopped: false, fallback: false,
      baselineIds: new Set((messagesRef.current[activeChat.current || draftKey(documentId)] || []).filter(m => !m.optimistic && !m.delivery).map(m => m.id)),
      requestId: retry?.documentId === documentId && retry.chatId === activeChat.current && retry.question === question ? retry.requestId : crypto.randomUUID(),
    };
    runRef.current = run; failedQuestion.current = question;
    setTransport('connecting');
    setPendingDocId(documentId); setGeneration({ stage: 'understanding', phase: 'generating' }); setSendError(''); setSendErrorAction('reload');
    retryTurn.current = null;
    updateMessages(run, existing => [...existing.filter(m => !m.optimistic && !(m.delivery && m.saved === false)),
      { id: run.userId, timestamp: Date.now(), role: 'user', content: question, sources: [], optimistic: true },
      { id: run.assistantId, timestamp: null, role: 'assistant', content: '', sources: [], live: run.live },
    ]);
    try {
      if (!run.chatId) {
        const chat = await createChat(documentId, { signal: run.controller.signal });
        if (!current(run)) return;
        const oldKey = run.key;
        run.chatId = chat._id; run.key = chat._id;
        const chatKey = run.key;
        setMessagesByChat(previous => { const next = { ...previous, [chatKey]: mergeMessages(previous[chatKey] || [], previous[oldKey] || []) }; delete next[oldKey]; return next; });
        optionsRef.current.onUsageChange?.();
        activeChat.current = chat._id; setActiveChatId(chat._id);
        setConversations(previous => {
          const items = [chat, ...previous.filter(item => item._id !== chat._id)];
          cache.current.set(documentId, { items, at: Date.now() }); return items;
        });
      }
      run.requestStarted = true;
      const result = await streamChatMessage(run.chatId, question, {
        signal: run.controller.signal, requestId: run.requestId,
        onEvent: ({ event, data }) => {
          if (!current(run) || run.controller.signal.aborted) return;
          if (['accepted', 'meta'].includes(event) && !run.accepted) { run.accepted = true; optionsRef.current.onUsageChange?.(); }
          if (['accepted', 'meta', 'done'].includes(event)) updateChatQuota(run.chatId, data.chat ?? data);
          if (event === 'open') setTransport('stream');
          if (event === 'fallback') { setTransport('fallback'); run.fallback = true; run.live.stage('generating'); setGeneration({ stage: 'generating', phase: 'generating' }); }
          if (event === 'status') { run.live.stage(data.stage); setGeneration({ stage: data.stage, phase: 'generating' }); }
          if (event === 'meta') {
            run.messageId = data.messageId || run.messageId;
            run.mode = typeof data.mode === 'string' ? data.mode : undefined;
            run.sources = normalizeSources(data.sources, documentId);
            updateMessages(run, existing => existing.map(m => m.id === run.assistantId ? { ...m, sources: run.sources, mode: run.mode } : m));
          }
          if (event === 'token') run.live.append(data.text);
          if (event === 'done') { run.receivedDone = true; run.messageId = data.messageId; run.live.stage('finishing'); setGeneration({ stage: 'finishing', phase: 'generating' }); }
        },
      });
      if (!current(run)) return;
      if (result.transport === 'fallback') {
        updateChatQuota(run.chatId, result.chat ?? result);
        optionsRef.current.onUsageChange?.();
        run.live.finish('completed');
        updateMessages(run, existing => mergeMessages(existing.filter(m => m.id !== run.assistantId && m.id !== run.userId), [result.userMessage, result.assistantMessage]));
      } else {
        run.messageId = result.messageId || run.messageId;
        if (result.status === 'completed') await run.live.complete();
        if (!current(run)) return;
        const outcome = result.status === 'cancelled' || run.stopped ? 'stopped' : 'completed';
        localAnswer(run, outcome === 'completed' ? 'syncing' : outcome);
        setGeneration({ stage: 'saving', phase: 'syncing' });
        const confirmed = await reconcile(run, outcome);
        if (!current(run)) return;
        if (outcome === 'completed' && !confirmed) throw new ApiError('Saved answer not found after done.', 0, 'STREAM_UNCONFIRMED');
      }
      if (!current(run)) return;
      failedQuestion.current = ''; retryTurn.current = null;
      setConversations(previous => {
        const chat = previous.find(item => item._id === run.chatId);
        const updated = chat?.title === 'New conversation' ? { ...chat, title: question.slice(0, 100) } : chat;
        const items = updated ? [updated, ...previous.filter(item => item._id !== run.chatId)] : previous;
        cache.current.set(documentId, { items, at: Date.now() }); return items;
      });
    } catch (error) {
      if (!current(run)) return;
      if (error.code === 'DAILY_AI_LIMIT_REACHED') setDailyRejectionAt(Date.now());
      if (QUOTA_CODES.has(error.code)) {
        optionsRef.current.onError?.(error);
        if (error.code === 'CHAT_EXPIRED') updateChatQuota(run.chatId, { expiresAt: new Date().toISOString() });
      }
      const outcome = run.stopped ? 'stopped' : run.receivedDone ? 'unconfirmed' : 'failed';
      run.rejectedQuota = QUOTA_CODES.has(error.code) && !run.live.getContent();
      if (run.rejectedQuota) {
        run.live.finish('failed');
        updateMessages(run, existing => existing.filter(message => message.id !== run.assistantId && message.id !== run.userId));
        setRejectedDraft({ id: crypto.randomUUID(), question: run.question });
      } else localAnswer(run, outcome);
      if (!run.stopped) {
        setSendError(friendlyError(run.receivedDone ? { code: 'STREAM_UNCONFIRMED' } : error, 'chat', optionsRef.current.usage));
        setSendErrorAction(run.fallback || !run.requestStarted ? 'retry' : 'reload');
        if (run.fallback) retryTurn.current = { documentId, chatId: run.chatId, question, requestId: run.requestId };
      }
      if (run.chatId && !run.reconcileAttempted) {
        setGeneration({ stage: 'saving', phase: 'syncing' });
        try { await reconcile(run, outcome); }
        catch (syncError) {
          if (current(run) && !isAbort(syncError)) { setSendError(friendlyError(error, 'chat') + ' We could not check the saved conversation. Reload saved messages to continue.'); setSendErrorAction('reload'); setHistoryError('Please reload saved messages to continue.'); }
        }
      }
    } finally {
      run.live.finish(run.stopped ? 'stopped' : 'failed');
      if (run.requestStarted && current(run)) optionsRef.current.onUsageChange?.();
      if (runRef.current === run) {
        runRef.current = null; busyRef.current = false;
        if (mounted.current) { setPendingDocId(null); setGeneration(null); }
      }
    }
  };

  const stopGenerating = () => {
    const run = runRef.current;
    if (!run || run.stopped) return;
    run.stopped = true; run.live.finish('stopped'); run.controller.abort();
  };
  const reloadSaved = async () => {
    if (busyRef.current || !activeChat.current) return;
    if (await openHistory(activeChat.current, undefined, true)) { setSendError(''); retryTurn.current = null; failedQuestion.current = ''; }
  };

  const removeConversation = async id => {
    if (busyRef.current || deletingChatId || !conversations.some(chat => chat._id === id)) return;
    if (!window.confirm('Delete this conversation and its saved messages?')) return;
    const owner = scopeId, doc = documentId;
    setDeletingChatId(id); setDeleteError('');
    try {
      await deleteChat(id);
      if (mounted.current && activeScope.current === owner) optionsRef.current.onUsageChange?.();
      if (!mounted.current || activeScope.current !== owner || activeDocument.current !== doc) return;
      const items = conversations.filter(chat => chat._id !== id);
      setConversations(items); cache.current.set(doc, { items, at: Date.now() });
      setMessagesByChat(previous => { const next = { ...previous }; delete next[id]; return next; });
      if (activeChat.current === id) selectConversation(items[0]?._id || null);
    } catch (error) {
      if (mounted.current && activeScope.current === owner && activeDocument.current === doc) { setDeleteError('This conversation could not be deleted. Please try again.'); optionsRef.current.onError?.(error); }
    } finally { if (mounted.current && activeScope.current === owner) setDeletingChatId(null); }
  };

  return {
    activeConversation: conversations.find(chat => chat._id === activeChatId) || null,
    rejectedDraft, deletingChatId, deleteError, removeConversation, refreshConversations: () => loadConversations(documentId, true),
    conversations: stateScope === scopeId ? conversations : [], activeChatId: stateScope === scopeId ? activeChatId : null,
    messages: stateScope === scopeId ? messagesByChat[activeChatId || draftKey(documentId)] || EMPTY_MESSAGES : EMPTY_MESSAGES,
    historyLoading, historyError, sendError, sendErrorAction, pendingDocId, generation, transport, busyRef,
    historyReady: enabled && readyDocumentId === documentId && !historyLoading && !historyError,
    pagination: pages[activeChatId], selectConversation, newConversation, sendQuestion, stopGenerating, cancelGeneration,
    retryQuestion: () => sendErrorAction === 'reload' ? reloadSaved() : sendQuestion(failedQuestion.current),
    retryHistory: () => activeChat.current ? openHistory(activeChat.current, undefined, true) : loadConversations(documentId, true),
    loadOlder: () => { const before = pages[activeChat.current]?.before; if (before && !historyLoading && !busyRef.current) openHistory(activeChat.current, before); },
  };
}
