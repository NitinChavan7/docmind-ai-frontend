import { useId } from 'react';
import { BarChart3, X, RotateCcw, FileText, HardDrive, MessageSquare, Sparkles } from 'lucide-react';
import Modal from './Modal.jsx';
import { formatMB, formatReset } from '../lib/usage.js';

function UsageCard({ icon: Icon, title, used, limit, remaining, storage, footnote }) {
  const full = used >= limit;
  const display = value => storage ? formatMB(value) : value;
  return <article className={`usage-card ${full ? 'at-limit' : ''}`}>
    <div className="usage-card-title"><Icon size={17}/><h3>{title}</h3></div>
    <p className="usage-card-value"><strong>{display(used)}</strong><span>/ {display(limit)}</span></p>
    <progress aria-label={`${title} used`} value={Math.min(used, limit)} max={limit || 1}/>
    <p>{display(remaining)} {storage ? 'available' : 'remaining'}</p>
    {footnote && <small>{footnote}</small>}
  </article>;
}
export default function UsageDashboard({ usageState, open, onOpen, onClose, returnFocusRef }) {
  const id = useId(), { data, loading, error, refresh, updatedAt } = usageState;
  return <>
    <button className="usage-trigger" aria-label="Free plan usage" onClick={onOpen} aria-haspopup="dialog"><BarChart3 size={15}/><span>Free plan</span></button>
    {open && <Modal className="usage-dialog" role="dialog" labelledBy={id} onClose={onClose} returnFocusRef={returnFocusRef}>
      <header className="usage-dialog-heading"><div><span className="usage-eyebrow">YOUR WORKSPACE</span><h2 id={id}>Free Plan Usage</h2></div><button className="tool-button" aria-label="Close usage dashboard" onClick={onClose}><X size={19}/></button></header>
      <div className="usage-dialog-body">
        <div className="usage-refresh"><p>{loading ? 'Refreshing your usage...' : updatedAt ? 'Current workspace usage' : 'Usage is loaded from your account.'}</p><button disabled={loading} onClick={refresh}><RotateCcw size={13} className={loading ? 'spinner' : ''}/>Refresh usage</button></div>
        {error && <div className="usage-error" role="alert">{error} {data ? 'Last known values are shown below.' : 'No usage values are available.'}</div>}
        {!data && !error && <div className="usage-loading" role="status">Loading your plan limits and usage...</div>}
        {data && <div className="usage-grid">
          <UsageCard icon={FileText} title="PDF documents" used={data.used.pdfs} limit={data.limits.pdfs} remaining={data.remaining.pdfs}/>
          <UsageCard icon={HardDrive} title="Storage" used={data.used.storageBytes} limit={data.limits.storageBytes} remaining={data.remaining.storageBytes} storage/>
          <UsageCard icon={MessageSquare} title="Active conversations" used={data.used.chats} limit={data.limits.chats} remaining={data.remaining.chats}/>
          <UsageCard icon={Sparkles} title="Daily AI questions" used={data.used.dailyQuestions} limit={data.limits.dailyQuestions} remaining={data.remaining.dailyQuestions} footnote={`Resets ${formatReset(data.dailyResetAt)}`}/>
        </div>}
        <p className="usage-muted">Delete unused documents or conversations to free capacity.</p>
      </div>
    </Modal>}
  </>;
}
