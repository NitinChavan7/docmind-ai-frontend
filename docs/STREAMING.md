# Streaming chat integration

The existing React/Vite workspace, login and Google sign-in, guest PDF flow,
document viewer, and per-document conversations remain in place. No framework,
dependency, account flow or visual redesign was introduced for streaming.

## Request and response

`streamChatMessage(chatId, question, options)` in `src/services/chatApi.js`
uses the existing cookie/CSRF/authentication transport. It sends:

```http
POST http://localhost:5000/api/chats/:chatId/stream
Content-Type: application/json
Accept: text/event-stream
X-CSRF-Token: <existing session CSRF token>
```

```json
{"question":"What are the key points?"}
```

Fetch includes `credentials: 'include'`. The API base comes from `VITE_API_URL`.
The current backend rejects a `mode` field and has no mode selector or web
search routing, so the client does not send it. It also does not invent a stream
requestId or cancellation endpoint. The original `sendChatMessage` method and
public `sendMessage` export remain available; `streamMessage` is also exported.

The first received text appears immediately; buffered bursts are revealed at
16 ms intervals inside the active bubble. The LIVE badge appears only after a successful
SSE response opens. If the route falls back to complete-response delivery, the
interface says so explicitly instead of making it look like a live stream.

Received text and visible text are separate. A server response can contain many
token events and done in one browser read; done no longer flushes that entire
buffer into the bubble. The frontend finishes revealing those actual received
characters before replacing the temporary bubble with saved history. The local
Finishing your answer stage describes this display work, not another model call.
Stop freezes the visible prefix and releases any pending completion; switching
chats or unmounting discards the reveal queue. A larger backlog is revealed more
quickly to keep long answers responsive, and reduced-motion mode skips pacing.

The client checks HTTP status before consuming the body. Shared authentication
refresh and CSRF recovery may retry a rejected HTTP request before streaming
begins. A 200 stream is never automatically replayed. A 404, 405 or 501 on the
stream route falls back once to the existing non-stream endpoint. Network
failures, 5xx responses, unexpected 200 JSON and interrupted SSE do not trigger
another generation POST.

The parser handles split frames, multiple events per read, CRLF, multiline data,
heartbeat comments and UTF-8 characters split across byte reads. Known events
are JSON validated, and chat/message identity mismatches stop the request.

| Event | Frontend behavior |
| --- | --- |
| status | Display the server's understanding, retrieval, web-search or generation stage |
| meta | Capture chat/message IDs, mode and normalized PDF/web sources |
| token | Append only that text delta to the single active assistant bubble |
| done | Stop live output and load persisted history to replace temporary message IDs |
| error | Mark the partial answer incomplete and show a friendly error |
| cancelled | Mark the answer stopped and check saved history |

Web-search stage handling is forward-compatible UI support, not a claim that
the current document-only backend searches the web. Only supplied HTTP(S) source
URLs become external links; HTML and script URLs are never injected or executed.

## Stop, navigation and persistence

Stop generating is above the question composer on desktop and mobile. It
aborts the active POST and reader through AbortController. The frontend then
checks saved history with a separate, cancellable GET. Changing documents,
chats or accounts invalidates the request and aborts its stream and history
check, preventing late tokens from crossing conversations. App unmount also
disposes the live bubble's timer/subscribers. Reading-only mode hides the
assistant without discarding its request; return to Ask to stop or see the answer.

The local backend now registers `/api/chats/:chatId/stream` in
`modules/chat/index.js`. Its controller sends the assistant MongoDB ID in meta
and done, omits mode routing, and commits a complete turn before done. It
aborts upstream work on disconnect and discards unfinished turns before the
commit point. Disconnecting during a completed turn's database commit can
still leave that complete turn saved. The frontend checks history rather than
assuming a stop deleted server data.

After done, the assistant ID and matching new user message must appear in the
existing history endpoint before the UI treats the result as confirmed saved.
Their authoritative content replaces the temporary pair without adding another
bubble. Older loaded history is retained. If confirmation fails, text stays
visible with a Save not confirmed label and a Reload saved messages action.
Stopped and interrupted text is also explicitly marked; it is not written to
browser storage or represented as a saved successful answer.

The final local route/controller were checked against this contract. No backend
source was modified by this frontend implementation. An older running backend
may need a restart to serve the route; otherwise the client uses the documented
non-stream fallback.

## Exact manual checks

1. Start MongoDB, ChromaDB and Ollama using the backend's existing setup.
   In PowerShell, start Express (or keep the already-running backend):

   ```powershell
   Set-Location C:\Users\ASUS\Downloads\docmind-ai-backend
   npm run dev
   ```

   Confirm it listens at `http://localhost:5000` and mounts the stream route.

2. In the frontend `.env`, retain the existing Google client configuration and set:

   ```dotenv
   VITE_USE_API=true
   VITE_API_URL=http://localhost:5000
   ```

   Then, in another PowerShell terminal:

   ```powershell
   Set-Location C:\Users\ASUS\Downloads\docmind-ai-frontend\docmind-ai-frontend
   npm run dev
   ```

   Open `http://localhost:5173` using localhost consistently for cookie/CORS rules.

3. Preview a PDF as a guest. Send a question, sign in, and wait for authenticated
   upload/indexing. Confirm the same question resumes once. A signed-in user can
   instead choose an already indexed PDF and its saved conversation.

4. Open browser DevTools > Network and send a new question. Expect
   `POST /api/chats/<id>/stream`, request body containing only `question`, and a
   200 `text/event-stream` response. The question and assistant placeholder
   appear immediately; stages update and text grows in one assistant bubble.
   Enter sends; Shift+Enter inserts a newline; another Send stays disabled.

5. Allow completion. Expect done with a stable messageId, followed by
   `GET /api/chats/<id>/messages?limit=50`. No second generation POST should
   occur. Reload the page and reopen the conversation: the same saved pair
   should appear once. Test PDF page citations and any HTTP(S) web sources.

6. Ask a longer question and click Stop generating while tokens arrive. Text
   must stop, the request must close, and the UI must mark the partial stopped.
   The history check must follow the server's actual persistence result. With
   the current backend, a turn stopped before commit does not survive refresh.

7. During another generation, select a different saved chat or document. The
   previous stream must close, the new history must load, and late text must
   never appear in the new conversation. Repeat at mobile width (390 px), using
   Ask; Stop stays above the composer. Scroll up during a long answer: tokens
   must not force scrolling; Latest messages returns to the bottom.

8. Test browser DevTools Offline or interrupt the backend during a response.
   Expect a friendly failure and an incomplete/unconfirmed label, not a saved
   success. Reconnect and click Reload saved messages. Verify there was no
   automatic second POST. Empty answers and streams ending without done must
   also fail clearly. A cold Ollama startup should retain the processing card
   and Stop control rather than show an empty screen.

9. Against an older backend with no stream route, expect 404 followed by one
   `/messages` POST and the existing saved answer behavior. This is a complete
   response fallback, not simulated token streaming. Its Stop closes the client
   request; the older server may still finish work and save the turn.

10. Recheck registration returning to sign-in, Google sign-in, profile/sign-out
    confirmation, PDF upload/index retry, zoom/page navigation and saved chats.

## Files changed

Created:

- `src/lib/sse.js`: incremental SSE framing, decoding and reader cleanup.
- `src/lib/liveAnswer.js`: batched bubble subscription and lifecycle cleanup.
- `tests/streaming.test.js`: parser, streaming service, cancellation and live-state tests.
- `docs/STREAMING.md`: this contract, persistence policy and manual checklist.

Modified:

- `src/services/http.js`: raw streaming responses through shared auth/CSRF handling.
- `src/services/chatApi.js`, `src/services/api.js`: reusable streaming API and fallback.
- `src/hooks/useDocumentChat.js`: single live turn, Stop, request isolation and reconciliation.
- `src/components/ChatPanel.jsx`: live text, stages, Stop, incomplete states and web sources.
- `src/App.jsx`, `src/components/Sidebar.jsx`: generation controls and safe document switches.
- `src/lib/chat.js`, `src/lib/errors.js`: safe web sources and friendly streaming failures.
- `src/styles/workspace.css`: controls and status styling within the existing theme.
- `package.json`: include streaming tests in `npm test`.
- `README.md`: streaming behavior, limitations and testing notes.

## Verification

Run frontend checks with `npm test` and `npm run build`.
Node tests exercise the parser across chunk boundaries, byte-split UTF-8,
incremental notifications, abort/disposal, cookies/CSRF/auth refresh, route
fallback, terminal/error cases and source-link safety. Browser checks use the
Playwright skill with a temporary real HTTP SSE fixture and mocked account,
document and history endpoints, including reload consistency and failure states.
The neighboring backend's `node --test tests/streaming.test.js` uses its own
test MongoDB and simulated upstream model. No real Google credentials or real
Ollama answer quality is established by those fixture-based checks.

A separate browser verification also exercised the actual Express application,
registration/login, PDF upload, real Chroma indexing and local Ollama models
(`llama3.2:3b` and `nomic-embed-text`) against a temporary MongoDB database. No
API/model responses were mocked in that run. The answer visibly grew through
76 text updates before completion, saved-history confirmation succeeded, and
Stop was verified on a follow-up. The run used an isolated account database and
the bundled sample PDF; existing user documents/accounts were not used or changed. This confirms delivery through
the real services, not factual accuracy for arbitrary uploaded documents.

A buffered-response browser regression also delivered all token events and done
in a single response chunk. The 450-character answer still appeared through 88
visible updates before the single history reconciliation. The test also stopped
the queued reveal and checked that it retained one assistant bubble. Unit tests
cover completion ordering, cancellation, emoji boundaries and disposal of a
pending reveal.
