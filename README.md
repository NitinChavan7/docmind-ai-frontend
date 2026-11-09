# DocMind AI - React frontend

A JavaScript/React document workspace with cookie authentication, candidate
PDFs, server-saved conversations, and cited answers. The existing three-panel
design and animated response indicator are preserved.

## Run

Requires Node.js 20.19+ or 22.12+ and npm.

    npm install
    Copy-Item .env.example .env
    npm run dev

Open http://localhost:5173. Vite uses strictPort because the local backend's
credentialed CORS configuration allows this origin. Keep Express on port 5000
and its MongoDB, ChromaDB and Ollama dependencies running.

## Configuration

    VITE_USE_API=true
    VITE_API_URL=http://localhost:5000
    VITE_GOOGLE_CLIENT_ID=

The API URL accepts either the server origin or a base ending in /api.
Restart Vite when frontend configuration changes. Continue with Google appears
above the email form on both auth screens. It activates when /auth/config
returns the backend's public GOOGLE_CLIENT_ID. Set that Web OAuth client ID in
the backend .env, authorize http://localhost:5173 as a JavaScript origin, and
restart the backend. VITE_GOOGLE_CLIENT_ID is a fallback for older backends that
do not expose /auth/config; both IDs must match if that fallback is used.
No client secret belongs in a VITE_ variable.

The official Google Identity Services button obtains an ID credential and posts
only that credential to /auth/google with cookies and CSRF protection. The
frontend does not use a Google access token as an ID token or store the
credential in localStorage. Missing configuration keeps the button visible but
disabled, with email sign-in available. SDK loading failures offer a retry.

Set VITE_USE_API=false for the standalone offline preview. Only offline PDFs
and offline demo conversations use IndexedDB/localStorage. Signed-in documents
and conversation history come from the server and are not saved in browser
storage. In-memory conversation caches are discarded when the account exits.

## Integration

- Open the workspace immediately and restore an existing session in the background.
- Guests can select PDFs and preview them locally without an account. Guest PDFs
  stay in memory until sign-in; refreshing the page removes the guest preview.
- A guest's first question opens the sign-in dialog. Canceling retains the PDF
  and restores the question. After sign-in, upload and prepare the PDF through
  authenticated endpoints, then submit that question once. A preparation retry
  reuses the uploaded document instead of uploading another copy.
- Register, sign in with password or Google, and sign out with HttpOnly cookies.
- Header and sidebar profile buttons show the signed-in account's name, email,
  sign-in provider and document count. Sign-out first opens an accessible
  confirmation dialog; cancel, Escape and clicking outside keep the session.
  The dialog locks during sign-out and allows retry after a failed request.
- Duplicate email registration offers a direct sign-in action, retaining the
  email and clearing the password. Sign-out returns to the guest workspace and
  clears private document and conversation state.
- Account forms show inline field guidance and contextual errors without
  displaying backend exception details. Password and Google sign-in both use
  the same document-preserving dialog.
- Email/password registration returns to sign-in with a success message and the
  entered email. The backend's automatic registration session is revoked before
  that transition, so a refresh cannot bypass the explicit login step. A failed
  completion can be retried without submitting registration again.
- All API and PDF requests include credentials.
- Expired access cookies trigger one shared refresh request and one replay.
- JSON and binary PDF requests share refresh and error handling.
- The current backend's /auth/csrf token is sent on state-changing requests.
  A stale token is fetched again once after CSRF_INVALID.
- Upload PDFs up to 10 MB with multipart field "file", preview the authenticated
  /view blob, then index the PDF. Failed indexing offers a retry.
- Load candidate-specific conversations and paginated message history.
- Create a conversation on its first question. New chat preserves earlier chats.
- Show the question and one assistant placeholder immediately. POST to
  /chats/:chatId/stream, append SSE token deltas to that bubble, then reconcile
  the completed answer with GET /chats/:chatId/messages. Stop generating aborts
  the active request. An unavailable streaming route (404/405/501) falls back
  to POST /chats/:chatId/messages, which supplies the saved pair directly.
- The answer loader requires a real pending document ID and a matching selected
  document. Two null IDs represent an idle empty workspace, not a generation.
- Failed fallback requests retain their requestId for an explicit retry.
  A partially received stream is never replayed automatically. Incomplete or
  unconfirmed answers offer Reload saved messages instead of silently resending.
- Click one-based page citations to navigate the PDF.
- Switch between Read & ask and Read only. On phones and tablets, Read and Ask
  each use the full panel; a source citation opens Read at the cited page.
- The desktop assistant starts at 520 px or wider on large displays, with
  readable 15-16 px message text. Expand assistant gives chat the full workspace
  and Restore split view brings the PDF back. Opening a document replaces the
  introductory heading with a compact document toolbar to leave more reading room.
- Resize the assistant on large screens by dragging the divider or using its
  arrow keys (400-720 px preference, constrained by available space). Jump
  directly to a PDF page and reset zoom with Fit to width.
- Answers display safe text formatting for headings, bold text, inline code,
  and lists. Copy an answer, collapse its sources, or jump to the latest
  messages after scrolling up. The question composer grows with its content.
- Stale history/PDF/stream requests are aborted on selection changes. Earlier
  pages of history preserve scroll position. Changing chats refreshes saved
  history so a stopped or interrupted local answer cannot appear as persisted.
- A malformed citation cannot become a React object child. A chat rendering
  error has a recovery view, keeping the document workspace visible.

## Endpoint map

All paths are relative to the configured /api base.

| Operation | Method | Path |
| --- | --- | --- |
| CSRF token | GET | /auth/csrf |
| Register | POST | /auth/register |
| Password sign-in | POST | /auth/login |
| Google sign-in | POST | /auth/google |
| Current user | GET | /auth/me |
| Refresh | POST | /auth/refresh |
| Sign out | POST | /auth/logout |
| List documents | GET | /documents |
| Document details | GET | /documents/:documentId |
| Upload | POST | /documents/upload |
| PDF blob | GET | /documents/:documentId/view |
| Index | POST | /documents/:documentId/process |
| Delete | DELETE | /documents/:documentId |
| Conversations | GET | /chats?documentId=... |
| Create conversation | POST | /chats |
| Messages | GET | /chats/:chatId/messages?limit=50&before=... |
| Ask and save | POST | /chats/:chatId/messages |
| Stream and save | POST | /chats/:chatId/stream |

The document, authentication and chat route mounts and response shapes were
checked against the neighboring backend source. The main UI does not use the
legacy /rag/ask endpoint. Its adapter remains for compatibility only.

## Performance

The PDF engine and Google sign-in UI load in separate chunks. The main
production JavaScript bundle is approximately 322 KB minified, compared with
approximately 727 KB before code splitting. The PDF worker is loaded as needed.
Only one PDF page renders at a time, resize updates are batched by animation
frame, and raster pixel density is capped at 2.

Conversation messages are cached per chat in memory. Document conversation
lists have a 30-second cache. Auth refresh and CSRF acquisition share in-flight
requests; neither a token refresh nor a failed generation is retried endlessly.
Read requests time out after 30 seconds, PDF requests after 60 seconds,
generation after 3 minutes, and indexing after 10 minutes. A generation timeout
can leave a completed turn on the server; reload saved history before resending
a streaming question. Only non-stream fallback retries use the original request ID.

The first received text appears immediately; buffered text is revealed at
16 ms intervals and subscribed to by the
active assistant bubble. During generation, output is plain React text; safe
formatted rendering resumes after completion. The PDF and account tree do not
rerender for every token. PDF citations and safe HTTP(S) web source links remain
clickable. See [streaming integration and manual checks](docs/STREAMING.md).
Completion waits for the visible text queue before replacing it with saved
history, so token events and done arriving in one chunk cannot skip the reveal.
Stop and navigation cancel that queue. Reduced-motion preferences skip the
extra pacing while preserving the underlying SSE transport.

## Source

- src/services/api.js: public service entry point
- src/services/http.js: credentials, CSRF, refresh, errors, timeouts
- src/services/authApi.js: validated account operations
- src/services/documentApi.js: normalized documents and upload/index endpoints
- src/services/chatApi.js: conversations, paginated history and saved answers
- src/lib/sse.js: incremental SSE framing and UTF-8 decoding
- src/lib/liveAnswer.js: batched, request-scoped live answer subscription
- src/hooks/useDocumentChat.js: request cancellation, caching and optimistic UI
- src/components/AuthGate.jsx: contextual account dialog and session lifecycle
- src/lib/errors.js: friendly UI errors and account field validation
- src/components/PDFViewer.jsx: authenticated blobs, controls and resource cleanup
- src/components/ChatPanel.jsx: conversations, history, answers and citations

## Verify

    npm test
    npm run build

Service tests cover cookie refresh concurrency, PDF refresh, CSRF recovery,
cancellation, session changes, multipart uploads, citations, chat payloads,
account field validation and safe user-facing errors.
Streaming tests cover split SSE/CRLF/UTF-8, incremental text, abort/disposal,
pre-stream auth refresh, safe fallback, interrupted bodies, malformed/empty
answers, server cancellation, timeouts, and safe source URLs.
Browser QA covers login/register/logout, conversations, PDF retry, optimistic
messages, failed-question retry, pagination and mobile layout using mocked
authenticated endpoints. Guest-flow checks cover local preview, canceled sign-in,
retained questions, registration returning to sign-in, automatic question resume,
preparation retry without duplicate uploads, late library responses, sign-out
isolation and Google dialog sign-in/retry. Live anonymous session/CSRF routes were checked;
real account and Google sign-in require valid credentials/configuration.
Streaming browser checks use a temporary HTTP SSE fixture, with controlled
chunk delivery and mocked account/history endpoints. They cover one progressive
bubble, stop/disconnect, chat/document isolation, saved-history reconciliation,
refresh consistency, failure states and mobile controls. The neighboring
backend's streaming tests also run with its test database and simulated model;
these checks do not establish real Ollama answer quality.

Responsive browser checks cover 16 viewport sizes from 320 px to 1920 px,
including tablet and short landscape layouts. They verify chat width, readable
text, no horizontal page overflow, an onscreen composer, focus/resize controls,
navigation, citations, account dialogs and fresh guest authentication. A resized
viewport also checks the keyboard-height layout; no native mobile keyboard was
automated. The workspace follows visualViewport height changes and retains
pinch zoom support.

An additional browser run used the actual Express app, temporary MongoDB, real
Chroma and local Ollama models. Guest upload, registration/login, indexing,
first-chat streaming, saved-history confirmation and follow-up Stop passed
without mocked API/model responses. The first token now publishes immediately;
the LIVE badge distinguishes SSE from the explicitly labeled non-stream fallback.

The backend owns authorization, cookie flags, CORS, CSRF enforcement and
document isolation. Production must use HTTPS and a compatible deployment
topology for cookies. This frontend does not implement retrieval or OCR.

Profile cards now follow the selected header or sidebar button and stay within
the visible viewport. Saved conversations use a searchable custom menu with
arrow-key selection, Escape dismissal and focus return. Browser checks cover
left/right anchoring, search and empty results, mobile/landscape bounds and
sign-out cancellation. Account/history responses are mocked for these UI checks.
