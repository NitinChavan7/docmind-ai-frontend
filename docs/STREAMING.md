# Streaming chat integration

The chat service consumes authenticated POST SSE responses, displays incremental answers and confirms saved messages after completion.

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

The first received text appears immediately. Subsequent deltas are batched at
16 ms intervals and displayed in full, without a simulated typing queue. This
keeps rendering bounded while avoiding an extra delay after the backend finishes.
Only the active bubble subscribes to live text; completed answer formatting is
memoized so unrelated status updates do not reparse previous answers.

The LIVE badge appears after an SSE response opens. A complete-response fallback
is labelled separately. Stop freezes visible text and cancels the request;
switching chats or unmounting disposes the pending update. Saved-history
confirmation still happens after completion. Sources stay collapsed by default
and are shown after live output ends. The composer remains editable during
generation so a next question can be drafted; sending waits for the active turn.

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

Quota errors in HTTP responses or SSE `error` events retain their standardized
`code` and `details` for the shared friendly-error mapper. They do not trigger a
fallback or automatic generation replay. An optional `accepted` event can carry
question-count metadata; the first accepted/meta event and final outcome refresh
account usage, while token events do not. See [usage integration](USAGE.md).

## Stop, navigation and persistence

Stop generating is above the question composer on desktop and mobile. It
aborts the active POST and reader through AbortController. The frontend then
checks saved history with a separate, cancellable GET. Changing documents,
chats or accounts invalidates the request and aborts its stream and history
check, preventing late tokens from crossing conversations. App unmount also
disposes the live bubble's timer/subscribers. Reading-only mode hides the
assistant without discarding its request; return to Ask to stop or see the answer.

The backend registers `/api/chats/:chatId/stream` in
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

The backend uses Groq for generation and Qdrant for document retrieval. If an older backend does not serve the stream route, the client uses the documented non-stream fallback.

## Exact manual checks

1. Configure MongoDB, Supabase, Qdrant Cloud Inference and Groq using the backend README.
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
   also fail clearly. A slow upstream response should retain the processing card
   and Stop control rather than show an empty screen.

9. Against an older backend with no stream route, expect 404 followed by one
   `/messages` POST and the existing saved answer behavior. This is a complete
   response fallback, not simulated token streaming. Its Stop closes the client
   request; the older server may still finish work and save the turn.

10. Recheck registration returning to sign-in, Google sign-in, profile/sign-out
    confirmation, PDF upload/index retry, zoom/page navigation and saved chats.

## Verification

Run `npm test` and `npm run build` from the frontend root. The fixtures cover the transport/parser, authentication recovery, fallback, cancellation and live-answer lifecycle. Browser checks with mocked APIs also cover collapsed sources, document switching, editable drafts during generation, stopped requests, reduced motion and layouts at 320 px, 390 px and short landscape widths.

Use the manual checks above against a configured backend to verify the complete upload, retrieval, generation and persistence path. Live Google sign-in needs a valid OAuth client. Fixture-based checks do not establish cloud-model answer quality or deployed proxy behavior.
