import { useId } from 'react';
import { X, ShieldCheck, RotateCcw } from 'lucide-react';
import Modal from './Modal.jsx';
import { formatMB, formatReset } from '../lib/usage.js';

export function UsagePolicy({ usage }) {
  if (!usage) return <p className="usage-muted">Policy values will appear when usage is available.</p>;
  const l = usage.limits;
  return <div className="usage-policy-text">
    <p>This page describes Free Plan limits and retention rules. It is not a privacy policy or legal agreement.</p>
    <ul>
      <li>Up to {l.pdfs} PDFs, {formatMB(l.pdfSizeBytes)} per file, and {formatMB(l.storageBytes)} of total storage.</li>
      <li>Each PDF may contain up to {l.pdfPages} pages. Longer PDFs are rejected, never truncated.</li>
      <li>Up to {l.chats} active conversations and {l.questionsPerChat} accepted questions per conversation.</li>
      <li>Up to {l.dailyQuestions} AI questions per day. The daily allowance resets at midnight UTC. Your next reset is {formatReset(usage.dailyResetAt)}.</li>
      <li>PDF retention: {l.documentRetentionDays === null ? 'not supplied by the server' : l.documentRetentionDays + ' days'}. Conversation retention: {l.chatRetentionDays === null ? 'not supplied by the server' : l.chatRetentionDays + ' days'}. Each document and conversation shows its own expiry date.</li>
      <li>Deleting a PDF also removes its associated conversations and stored data. Deleting a conversation frees a conversation slot; deleting a PDF frees document and storage capacity after the server confirms deletion.</li>
    </ul>
    <p>Expired documents and conversations cannot be used for new requests. Storage cleanup may occur after expiry. Limits are checked for every request.</p>
  </div>;
}
export default function UsagePolicyDialog({ usageState, onClose, returnFocusRef }) {
  const id = useId(), { data, error, loading, refresh } = usageState;
  return <Modal className="usage-dialog policy-dialog" role="dialog" labelledBy={id} onClose={onClose} returnFocusRef={returnFocusRef}>
    <header className="usage-dialog-heading"><div><span className="usage-eyebrow">PLAN RULES</span><h2 id={id}>Limits &amp; retention</h2></div><button className="tool-button" aria-label="Close limits and retention" onClick={onClose}><X size={19}/></button></header>
    <div className="usage-dialog-body">
      <p className="policy-intro"><ShieldCheck size={19}/><span>File limits, question allowances and data retention.</span></p>
      {error && <div className="usage-error" role="alert">{error} {data ? 'Last known policy values are shown.' : 'Policy values are not available.'}</div>}
      {loading && !data ? <p className="usage-loading" role="status">Loading your plan rules...</p> : <UsagePolicy usage={data}/>}
      {error && <div className="usage-refresh"><button disabled={loading} onClick={refresh}><RotateCcw size={13}/>Retry policy</button></div>}
    </div>
    <footer className="policy-dialog-footer"><button onClick={onClose}>Got it</button></footer>
  </Modal>;
}
