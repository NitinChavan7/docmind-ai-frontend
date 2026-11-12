import { useId } from 'react';
import { BookOpen, FileText, Trash2, X } from 'lucide-react';
import Modal from './Modal.jsx';

export default function DeleteDocumentDialog({ doc, onClose, onConfirm, returnFocusRef }) {
  const titleId = useId(), descriptionId = useId();
  return <Modal className="delete-document-dialog" labelledBy={titleId} describedBy={descriptionId} onClose={onClose} returnFocusRef={returnFocusRef}>
    <div className="delete-document-card">
      <div className="delete-document-top"><span><BookOpen size={18}/>docmind</span><button className="tool-button" aria-label="Close delete confirmation" onClick={onClose}><X size={18}/></button></div>
      <span className="delete-document-symbol"><Trash2 size={24} strokeWidth={1.5}/></span>
      <h2 id={titleId}>Delete this document?</h2>
      <p id={descriptionId}>This will permanently delete the PDF and its saved conversations from your library. This action cannot be undone.</p>
      <div className="delete-document-file"><FileText size={21}/><span><strong>{doc.name}</strong><small>PDF document</small></span></div>
      <div className="delete-document-actions"><button data-autofocus onClick={onClose}>Cancel</button><button className="delete-document-confirm" onClick={onConfirm}><Trash2 size={16}/>Delete document</button></div>
    </div>
  </Modal>;
}
