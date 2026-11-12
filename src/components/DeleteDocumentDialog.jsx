import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, FileText, LoaderCircle, Trash2, X } from 'lucide-react';
import Modal from './Modal.jsx';

export default function DeleteDocumentDialog({ doc, onClose, onConfirm, returnFocusRef }) {
  const titleId = useId(), descriptionId = useId();
  const [confirming, setConfirming] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!confirming) return;
    // The request starts immediately; this timer only completes visual feedback.
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
    const timer = setTimeout(() => close.current(), delay);
    return () => clearTimeout(timer);
  }, [confirming]);
  const confirm = () => { if (!confirming) { setConfirming(true); onConfirm(); } };
  return <Modal className={`delete-document-dialog ${confirming ? 'is-removing' : ''}`} busy={confirming} labelledBy={titleId} describedBy={descriptionId} onClose={onClose} returnFocusRef={returnFocusRef}>
    <div className="delete-document-card" aria-busy={confirming}>
      <div className="delete-document-top"><span><BookOpen size={18}/>docmind</span><button className="tool-button" aria-label="Close delete confirmation" disabled={confirming} onClick={onClose}><X size={18}/></button></div>
      <span className="delete-document-symbol">{confirming ? <LoaderCircle size={24} className="spinner"/> : <Trash2 size={24} strokeWidth={1.5}/>}</span>
      <h2 id={titleId}>{confirming ? 'Removing document...' : 'Delete this document?'}</h2>
      <p id={descriptionId}>This will permanently delete the PDF and its saved conversations from your library. This action cannot be undone.</p>
      <div className="delete-document-file"><FileText size={21}/><span><strong>{doc.name}</strong><small>PDF document</small></span></div>
      <div className="delete-document-actions"><button data-autofocus disabled={confirming} onClick={onClose}>Cancel</button><button className="delete-document-confirm" disabled={confirming} onClick={confirm}>{confirming ? <LoaderCircle size={16} className="spinner"/> : <Trash2 size={16}/ >}{confirming ? 'Removing...' : 'Delete document'}</button></div>
    </div>
  </Modal>;
}
