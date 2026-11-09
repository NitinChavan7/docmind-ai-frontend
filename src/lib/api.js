// Compatibility export for consumers of the original frontend adapter.
import { askDocumentQuestion } from '../services/ragApi.js';
export { API_BASE } from '../services/http.js';
export const askDocument = ({ documentId, question }) => askDocumentQuestion(documentId, question);
