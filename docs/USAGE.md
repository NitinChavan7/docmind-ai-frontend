# Free Plan Usage

The workspace header has a **Free plan** button (a chart icon on phones). It opens a responsive dashboard with PDF count, storage, active conversations and daily AI questions. Each card shows current use, its server-provided limit, remaining capacity and a labelled progress bar. The daily card also shows the server reset timestamp in the browser's local timezone.

The upload control has a **Limits & retention** link that opens the policy directly. **Free plan** opens the usage overview. These are separate dialogs: the dashboard contains usage cards, and the policy dialog contains plan rules and retention information. Neither includes tabs to the other. The existing native file chooser, upload/index feedback and PDF preview remain in place.

## Backend integration status

At implementation time, neither the local backend checkout nor its GitHub default branch registered `/api/usage` or `DELETE /api/chats/:chatId`. No real usage response was available. The frontend is implemented and tested against the contract below; the actual backend response and delete route still need confirmation. No backend files were changed.

Missing, malformed or unavailable usage data is shown as unavailable, not as invented zero counts. Existing PDFs and saved messages remain readable; authenticated uploads and new questions wait until limits can be fetched. Offline preview and guest preview retain their existing local behavior.

## API contract

`GET /api/usage` uses the existing shared HTTP client, credentials, refresh handling and configured `/api` base. There are no new Vite variables or service keys. Responses are normalized by [usage.js](../src/lib/usage.js); adapt that one mapping if the backend names differ.

This is an illustrative test response, not frontend default policy or actual account usage:

```json
{
  "success": true,
  "data": {
    "plan": "free",
    "limits": {
      "pdfs": 5,
      "pdfSizeBytes": 10485760,
      "storageBytes": 52428800,
      "pdfPages": 25,
      "chats": 10,
      "questionsPerChat": 50,
      "dailyQuestions": 30,
      "documentRetentionDays": 30,
      "chatRetentionDays": 30
    },
    "usage": {
      "pdfs": 2,
      "storageBytes": 12582912,
      "chats": 3,
      "dailyQuestions": 12
    },
    "dailyResetAt": "2026-11-12T00:00:00.000Z"
  }
}
```

The adapter also supports common long-form names such as `maxDocuments`, `maxFileSizeBytes`, `maxTotalStorageBytes`, `maxPdfPages`, `maxChats`, `maxQuestionsPerChat`, `maxDailyQuestions`, `documentCount`, `totalStorageBytes`, `activeChats`, `questionsToday`, and `resetAt`. MB limits are supported through `maxFileSizeMB` and `maxTotalStorageMB`. Numbers must be finite, nonnegative JSON numbers; required missing counters/limits fail validation. Missing retention/reset fields are labelled as unavailable.

Document and chat records may include an ISO `expiresAt`. Chat list records, `data.chat` in message history, and SSE metadata may expose `questionCount` (accepted user questions) and/or `remainingQuestions`. `acceptedQuestionCount`, `userQuestionCount` and `questionsRemaining` are also recognized. If a complete, unpaginated saved history is available, persisted user messages provide a fallback count; partial history and streamed tokens are never treated as a total. Inferred history counts do not reduce a larger server-provided count.

The conversation menu's **Delete selected conversation** action sends authenticated, CSRF-protected `DELETE /api/chats/:chatId`. The server must confirm success before the UI removes the conversation or refreshes its freed slot. A failure leaves the item in place and displays an error.

## Refresh and reset behavior

Usage is fetched after sign-in and refreshed after upload, document deletion, chat creation/deletion, the first accepted/meta stream event and generation completion/failure. JSON fallback completion also refreshes it. Concurrent refreshes are shared, with one trailing refresh when another mutation requests an update during an in-flight request. Token events do not fetch usage.

The hook cancels old account requests and clears account usage on sign-out or account changes. Window focus refreshes usage. A timer uses the server's `dailyResetAt` exactly; the browser does not calculate its own midnight or award questions locally. If a reset response still says exhausted, sending stays blocked.

Expiry indicators use local calendar dates while retaining the server timestamp. An expiry transition refreshes the affected lists and usage once per item. Expired documents cannot start PDF reads, indexing or questions; expired chats cannot accept new questions. Deletion remains available for cleanup. The UI does not claim that physical cloud deletion is complete merely because an item expired.

## Error handling

Known codes map to safe messages in [usage.js](../src/lib/usage.js), called centrally from [errors.js](../src/lib/errors.js). Both HTTP JSON errors and SSE error events preserve `code` and `details`. Supported codes:

- `PDF_COUNT_LIMIT_REACHED`
- `PDF_SIZE_LIMIT_EXCEEDED`
- `TOTAL_STORAGE_LIMIT_REACHED`
- `PDF_PAGE_LIMIT_EXCEEDED`
- `INVALID_PDF_FILE`
- `CHAT_LIMIT_REACHED`
- `CHAT_QUESTION_LIMIT_REACHED`
- `DAILY_AI_LIMIT_REACHED`
- `CHAT_RATE_LIMIT_REACHED`
- `GENERATION_ALREADY_RUNNING`
- `DOCUMENT_EXPIRED`
- `CHAT_EXPIRED`

Error details may supply `maxDocuments`, `maxPdfs`, `maxFileSizeBytes`, `maxFileSizeMB`, `maxPages`, `maxPdfPages`, `maxChats`, or `resetAt`; otherwise messages use fetched limits. Private server messages and stack traces are not rendered for these codes. Quota/rate errors never trigger the non-stream fallback or an automatic generation replay.

Uploads check extension/MIME, the PDF signature, backend file-size limits, PDF slots and total storage. The server still validates page count and handles stale prevalidation. A PDF rejected for pages is not truncated. Failed indexing does not falsely free an already uploaded PDF slot.

A full conversation disables the composer and offers another chat if capacity remains. A full daily allowance blocks new questions while leaving saved history readable. A quota rejection before any answer text removes temporary empty messages and restores the question draft. Partial streams keep the existing incomplete-answer and history-reload behavior.

## Final policy text

The UI uses this text with bracketed values filled from the API, never numeric frontend defaults:

> This is a guide to the Free Plan's usage limits, not legal terms or a privacy policy.
>
> Up to [maximum PDFs] PDFs, [maximum individual size] per file, and [maximum total storage] of total storage.
>
> Each PDF may contain up to [maximum pages] pages. Longer PDFs are rejected, never truncated.
>
> Up to [maximum conversations] active conversations and [maximum questions per conversation] accepted questions per conversation.
>
> Up to [daily AI allowance] AI questions per day. The daily allowance resets at midnight UTC. Your next server-provided reset is [local reset date/time].
>
> PDF retention: [document retention days] days. Conversation retention: [chat retention days] days. Individual expiry timestamps determine when an item becomes unavailable.
>
> Deleting a PDF also removes its associated conversations and stored data. Deleting a conversation frees a conversation slot; deleting a PDF frees document and storage capacity after the server confirms deletion.
>
> Expired items cannot be used for new requests. An expiry label does not confirm that physical cloud deletion has finished. The server checks every request and remains authoritative.

If retention fields or the reset timestamp are missing, those clauses explicitly say the information was not supplied rather than inventing a value. There is no paid-plan or upgrade flow.

## Files changed for this feature

React components:

- New: [UsageDashboard.jsx](../src/components/UsageDashboard.jsx) and [UsagePolicyDialog.jsx](../src/components/UsagePolicyDialog.jsx)
- [App.jsx](../src/App.jsx): usage state, prevalidation and workspace integration
- [Sidebar.jsx](../src/components/Sidebar.jsx): upload rules, blocked reasons and expiry labels
- [PDFViewer.jsx](../src/components/PDFViewer.jsx): expired document state and safe account-limit copy
- [ChatPanel.jsx](../src/components/ChatPanel.jsx): allowances, disabled states, quota messages and recovery actions
- [ConversationPicker.jsx](../src/components/ConversationPicker.jsx): chat expiry, creation limits and confirmed deletion

Hooks and services:

- New: [useUsage.js](../src/hooks/useUsage.js), [usageApi.js](../src/services/usageApi.js), [usage.js](../src/lib/usage.js)
- [useDocumentChat.js](../src/hooks/useDocumentChat.js): lifecycle refreshes, accepted-question metadata, deletion and rejected drafts
- [http.js](../src/services/http.js), [chatApi.js](../src/services/chatApi.js), [documentApi.js](../src/services/documentApi.js), [api.js](../src/services/api.js), [errors.js](../src/lib/errors.js)
- [workspace.css](../src/styles/workspace.css), [usage.test.js](../tests/usage.test.js), [package.json](../package.json), and the main README

Authentication components and the Google ID-token flow were not replaced. The existing cookie/CSRF transport, Vercel proxy, PDF reader, stream parser, answer formatting, citations, auto-scroll and completed-message reconciliation are retained.

## Local testing

```powershell
npm install
npm test
npm run build
npm run dev
```

Open `http://localhost:5173` with an API that implements the documented usage/delete contract. Sign in, open **Free plan**, and select **Limits & retention** to read the policy. Confirm the displayed limits match the server configuration.

1. Upload a valid PDF with available capacity; verify upload, indexing, preview and the refreshed counts.
2. Test the count limit, an oversized file, insufficient storage and a server-side page-limit rejection. Check friendly copy and that blocked uploads do not create requests.
3. Reach the chat limit. Delete a conversation from the saved-conversation menu and verify a slot becomes available only after success.
4. Load a conversation at its question limit, confirm sending is blocked and start another chat when allowed.
5. Exhaust daily usage. Confirm no repeated generation POSTs and verify automatic refresh at the supplied reset timestamp.
6. Return the quota codes in HTTP and SSE errors. Confirm drafts survive rejection, stack traces stay hidden and no generation is replayed.
7. Test expired PDFs/chats and a failed deletion. Confirm refreshes, blocked new operations and readable saved history where the server still permits it.
8. Check the dashboard at 320 px, 390 px, tablet and short landscape sizes. Test Escape, focus return and progress labels.
9. Test password and configured Google sign-in, sign-out, refresh cookies and account switching.

Automated tests use fixtures. Browser verification covered 18 flows with mocked API responses, including upload/index/view, SSE persistence/citations, quotas, deletion refreshes, reset timing, expiry, password login, sign-out and responsive dialogs. Existing Google credential/transport tests remain part of the suite; no live Google account or deployed cloud quota enforcement was exercised. Native phone keyboard/safe-area behavior still needs device testing.
