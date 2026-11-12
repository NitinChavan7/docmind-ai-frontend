import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, MessageSquare, Plus, Search, X, Trash2 } from 'lucide-react';
import { expiryLabel, isExpired } from '../lib/usage.js';
import useAnchoredPanel from '../hooks/useAnchoredPanel.js';

export default function ConversationPicker({ conversations, activeChatId, loading, onSelect, onNew, newChatReason, onDelete, deletingId, now }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const trigger = useRef(null), panel = useRef(null), search = useRef(null);
  const id = useId();
  const items = [{ _id: '', title: 'New conversation' }, ...conversations].filter(chat => chat.title.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  const selected = conversations.find(chat => chat._id === activeChatId);
  const style = useAnchoredPanel(open, trigger.current, panel, 'bottom', Math.max(320, trigger.current?.offsetWidth || 0));
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const choose = chat => { if (!chat._id && newChatReason) return; close(true); if (chat._id) onSelect(chat._id); else onNew(); };
  useEffect(() => {
    if (!open) return;
    search.current?.focus({ preventScroll: true });
    const outside = event => { if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  useEffect(() => { if (loading) setOpen(false); }, [loading]);
  useEffect(() => { panel.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, query]);
  const openMenu = () => { setQuery(''); setActive(Math.max(0, conversations.findIndex(chat => chat._id === activeChatId) + 1)); setOpen(true); };
  const keyDown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setActive(value => event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, items.length - 1) : Math.max(0, Math.min(items.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1))));
    }
    if (event.key === 'Enter' && items[active]) { event.preventDefault(); choose(items[active]); }
  };
  return <div className="conversation-picker">
    <button ref={trigger} className={`conversation-trigger ${open ? 'is-open' : ''}`} aria-label="Saved conversations" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={loading} onClick={() => open ? close() : openMenu()} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(); } }}>
      <MessageSquare size={16}/><span>{loading ? 'Loading conversations…' : selected?.title || 'New conversation'}{selected?.expiresAt && <small className="expiry-label" title={new Date(selected.expiresAt).toLocaleString()}>{expiryLabel(selected.expiresAt, now)}</small>}</span><ChevronDown size={15}/>
    </button>
    <button className="new-conversation" title={newChatReason || 'Start a new conversation'} aria-label="Start a new conversation" disabled={loading || Boolean(newChatReason) || Boolean(deletingId)} onClick={onNew}><Plus size={16}/><span>New chat</span></button>
    {open && createPortal(<section id={id} ref={panel} className="conversation-menu" style={style} role="dialog" aria-label="Choose a conversation" onKeyDown={keyDown}>
      <div className="conversation-menu-heading"><span>YOUR CONVERSATIONS</span><button className="tool-button" aria-label="Close conversations" onClick={() => close(true)}><X size={16}/></button></div>
      <div className="conversation-search"><Search size={16}/><input ref={search} placeholder="Find a conversation…" aria-label="Find a conversation" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={items[active] ? `${id}-${active}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }}/></div>
      <div className="conversation-options" id={`${id}-list`} role="listbox" aria-label="Saved conversations">
        {items.map((chat, index) => <div role="option" id={`${id}-${index}`} key={chat._id} aria-selected={chat._id === (activeChatId || '')} data-active={index === active} aria-disabled={!chat._id && Boolean(newChatReason)} className={`conversation-option ${chat._id ? '' : 'conversation-option-new'} ${isExpired(chat,now) ? 'expired' : ''}`} onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => choose(chat)}>
          {chat._id ? <MessageSquare size={16}/> : <Plus size={17}/>}<span>{chat.title}<small>{chat._id ? expiryLabel(chat.expiresAt,now) || 'Saved conversation' : newChatReason || 'Start a separate conversation'}</small></span>{chat._id === (activeChatId || '') && <Check size={16}/>}
        </div>)}
        {!items.length && <div className="conversation-empty"><MessageSquare size={22}/><strong>No conversations found</strong><span>Try another word or start a new chat.</span></div>}
      </div>
      {selected && onDelete && <button className="delete-conversation" disabled={Boolean(deletingId)} onClick={() => { close(); onDelete(selected._id); }}><Trash2 size={14}/>{deletingId ? 'Deleting conversation...' : 'Delete selected conversation'}</button>}
      <div className="conversation-menu-hint">Your conversations stay with this document.</div>
    </section>, document.body)}
  </div>;
}
