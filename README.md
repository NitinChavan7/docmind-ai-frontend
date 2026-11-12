# DocMind AI

Read a PDF and ask questions about it in the same workspace. DocMind AI pairs a PDF viewer with document conversations, streamed answers and clickable page references.

Built by **Nitin Chavan** | [Portfolio](https://nitin-chavan-portfolio.vercel.app/)

## Features

- Start from a focused guest upload screen on desktop or mobile. After choosing a PDF, preview it locally; small screens open in Read mode. Sign in when you want to ask a question, with the selected PDF and question carried over.
- Register or sign in with email and password, or use Google when configured.
- Upload PDFs up to 10 MiB, index them, and reopen your document library.
- Keep multiple saved conversations for each PDF and load older messages.
- Read answers as they arrive without an added typing delay, stop generation, draft your next question, copy answers and open cited pages. Sources stay collapsed until you need them.
- Open PDFs with a lightweight loading skeleton and a subtle page reveal. Motion follows your reduced-motion preference.
- Adjust the PDF zoom, jump to a page, resize the desktop assistant or expand it to fill the workspace.
- Use full-width Read and Ask panels below 1280 px, with a resizable split view on larger screens. PDF tools adapt to the reader pane width, including after resizing.
- Use a compact PDF tools menu for downloads and opening the file in a new tab. On narrow panes, Fit to width moves into that menu.

## Stack

The frontend uses React 19, Vite 6, Tailwind CSS 4, React-PDF and Lucide icons. The Express backend stores accounts, document metadata and conversations in MongoDB, PDFs in Supabase Storage, and searchable chunks in Qdrant. Qdrant Cloud Inference creates embeddings; Groq generates answers. Retrieval and prompts run on the backend.

## Free plan usage

Open **Free plan** in the workspace header to view PDF, storage, conversation and daily-question allowances. Upload controls also link to **Limits & retention**. The interface reads limits from the authenticated usage API, shows expiry dates and blocks exhausted quotas without hiding saved history.

The local backend checkout does not yet expose the new usage or chat-delete routes. The feature is verified with API fixtures; confirm the response contract with your backend before deploying. See [usage integration, final policy and testing](docs/USAGE.md).

## Local setup

Use Node.js 22.12+ and npm. From this directory:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open [localhost:5173](http://localhost:5173). Vite requires that port to be available. Start the backend separately on port 5000 and include `http://localhost:5173` in its `CLIENT_URL`.

```dotenv
VITE_USE_API=true
VITE_API_URL=http://localhost:5000
VITE_GOOGLE_CLIENT_ID=
```

`VITE_API_URL` accepts a server origin or a base ending in `/api`. In development, an unset URL defaults to `http://localhost:5000`. In a production build it defaults to same-origin `/api`. Restart Vite after changing environment values.

Google sign-in normally reads the backend's public client ID from `/api/auth/config`. `VITE_GOOGLE_CLIENT_ID` is a fallback for older backends. If set, it must match the backend client ID. Authorize the frontend origin in the Google Web OAuth client. Without configuration, email sign-in remains available and the Google button is disabled. Never put a client secret or service API key in a `VITE_` variable.

For a standalone preview, set `VITE_USE_API=false`. Offline PDFs use IndexedDB and demo conversations use localStorage. API-mode guest previews stay in memory; signed-in documents and saved conversations come from the server.

## How document chat works

1. Select a PDF. Guests can read it locally before signing in.
2. On the first question, sign in if needed. The app uploads the PDF and requests indexing before sending the retained question.
3. The backend retrieves relevant chunks from the selected document and supplies them, along with saved conversation history, to Groq.
4. The frontend reads SSE events from `POST /api/chats/:chatId/stream` and updates one answer bubble.
5. After completion, it reloads saved messages to confirm persistence. Page references navigate the PDF viewer.

Stopping or losing a stream can leave visible text that is not saved. The interface marks that state and offers a history reload. A partially received stream is never automatically sent again. If the streaming route returns 404, 405 or 501, the client falls back once to the JSON message endpoint.

Requests use cookies, shared session refresh and CSRF protection. Account, document and chat changes cancel stale requests and clear private in-memory state as appropriate. The backend enforces ownership and access control.

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/App.jsx` | Workspace, document selection and guest flow |
| `src/components/` | Guest welcome screen, account dialogs, sidebar, PDF viewer and chat interface |
| `src/hooks/useDocumentChat.js` | Conversation history, streaming, cancellation and saved-message confirmation |
| `src/services/` | Authentication, documents, chat and shared HTTP transport |
| `src/lib/` | SSE parsing, live-answer state, storage, normalization and errors |
| `src/styles/` | Application styles and responsive layouts |
| `tests/` | API, session/chat and streaming tests |
| [docs/STREAMING.md](docs/STREAMING.md) | Streaming behavior and manual checks |
| [docs/USAGE.md](docs/USAGE.md) | Usage API contract, policy, quota handling and test steps |

## API routes

Paths below are relative to `/api`.

| Area | Routes used by the frontend |
| --- | --- |
| Usage | `GET /usage` |
| Authentication | `GET /auth/config`, `GET /auth/csrf`, `GET /auth/me`; `POST /auth/register`, `/auth/login`, `/auth/google`, `/auth/refresh`, `/auth/logout` |
| Documents | `GET /documents`, `GET /documents/:id`, `GET /documents/:id/view`; `POST /documents/upload`, `POST /documents/:id/process`; `DELETE /documents/:id` |
| Conversations | `GET /chats?documentId=...`, `POST /chats`, `DELETE /chats/:id` |
| Messages | `GET /chats/:id/messages?limit=50&before=...`, `POST /chats/:id/messages`, `POST /chats/:id/stream` |

The main workspace uses chat routes. The older `/rag/ask` adapter remains in the source for compatibility.

## Checks

```powershell
npm test
npm run build
npm run preview
```

The Node tests cover request handling, session changes, chat behavior, SSE parsing, cancellation and live-answer state. Environment access supports both Node tests and Vite builds. Browser checks with mocked API responses cover document selection, source citations, stopping generation, drafting during generation and document isolation. Responsive checks cover 16 viewport sizes from 320 to 1920 px, including short landscape layouts, long filenames, touch controls, PDF tools, drawer keyboard focus and guest sign-in dialogs. Native mobile keyboards and physical-device safe areas have not been automated. These checks do not establish live cloud-model latency or answer quality.

## Deployment

Vite writes the production build to `dist/`. The included `vercel.json` forwards `/api/*` to the configured Render backend and serves `index.html` for application routes. Update that destination for your deployment. Leave `VITE_API_URL` unset or empty to use this same-origin API path.

The backend uses HttpOnly cookies with SameSite=Lax and Secure in production. Keep the browser-facing frontend and API on a compatible same-site setup, configure the allowed frontend origin, and check that your proxy forwards cookies and streams responses without buffering.
