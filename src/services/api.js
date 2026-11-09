// One public entry point; transport, normalization and credentials remain shared.
export { register as registerUser, login as loginUser, googleLogin as loginWithGoogle, getCurrentUser, logout as logoutUser } from './authApi.js';
export { getDocuments, getDocument, uploadDocument as uploadPdf, processDocument as processPdf, deleteDocument } from './documentApi.js';
export { createChat, getCandidateChats, getChatMessages, sendChatMessage as sendMessage, streamChatMessage as streamMessage } from './chatApi.js';
import { getDocumentFileUrl } from './documentApi.js';
import { fetchPrivatePdf } from './http.js';
export const getPdfBlob = (documentId, signal) => fetchPrivatePdf(getDocumentFileUrl(documentId), signal);
