import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDocuments, getDocumentFileUrl, uploadDocument, processDocument, deleteDocument } from '../src/services/documentApi.js';
import { askDocumentQuestion } from '../src/services/ragApi.js';
import { request, resetCredentials } from '../src/services/http.js';
import { normalizeMessages, isAnswerPending } from '../src/lib/chat.js';

function mockFetch(t, handler) { resetCredentials(); t.mock.method(globalThis, 'fetch', (url, options) => url.endsWith('/auth/csrf') ? Promise.resolve(json({ data: { csrfToken: 'test-csrf' } })) : handler(url, options)); }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('the answer loader requires a real pending document, never two empty IDs', () => {
  assert.equal(isAnswerPending(null, null), false);
  assert.equal(isAnswerPending(undefined, undefined), false);
  assert.equal(isAnswerPending('', ''), false);
  assert.equal(isAnswerPending(null, 'document-id'), false);
  assert.equal(isAnswerPending('document-id', null), false);
  assert.equal(isAnswerPending('other-document', 'document-id'), false);
  assert.equal(isAnswerPending('document-id', 'document-id'), true);
});

test('server document metadata maps to a remote PDF, preserving the server ID', async t => {
  mockFetch(t, async url => {
    assert.equal(url, 'http://localhost:5000/api/documents');
    return json({success:true,data:[{documentId:'mongo-id',originalName:'Research.pdf',fileSize:1024,status:'ready',pageCount:3}]});
  });
  const [doc] = await getDocuments();
  assert.equal(doc.id, 'mongo-id');
  assert.equal(doc.name, 'Research.pdf');
  assert.equal(doc.size, 1024);
  assert.equal(doc.status, 'ready');
  assert.equal(doc.fileUrl, getDocumentFileUrl('mongo-id'));
  assert.equal(doc.remote, true);
});

test('upload sends the file as multipart without overriding its boundary', async t => {
  mockFetch(t, async (url, options) => {
    assert.equal(url, 'http://localhost:5000/api/documents/upload');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.get('Content-Type'), null);
    assert.equal(options.headers.get('X-CSRF-Token'), 'test-csrf');
    assert.equal(options.credentials, 'include');
    assert.equal(options.body.get('file').name, 'Guide.pdf');
    return json({success:true,data:{documentId:'server-upload',status:'uploaded'}});
  });
  const doc = await uploadDocument(new File(['%PDF-1.4'], 'Guide.pdf', {type:'application/pdf'}));
  assert.equal(doc.id, 'server-upload');
  assert.equal(doc.name, 'Guide.pdf');
  assert.equal(doc.status, 'uploaded');
});

test('index and delete use the server ID and allow an empty 204 response', async t => {
  const calls=[];
  mockFetch(t, async (url, options) => {
    calls.push([url, options.method]);
    return new Response(null, {status:204});
  });
  await processDocument('server-id');
  await deleteDocument('server-id');
  assert.deepEqual(calls, [
    ['http://localhost:5000/api/documents/server-id/process','POST'],
    ['http://localhost:5000/api/documents/server-id','DELETE'],
  ]);
});

test('RAG sends the backend contract and normalizes pageNumber citations', async t => {
  mockFetch(t, async (url, options) => {
    assert.equal(url,'http://localhost:5000/api/rag/ask');
    assert.deepEqual(JSON.parse(options.body),{documentId:'server-id',question:'What matters?'});
    return json({success:true,data:{answer:'A grounded answer.',sources:[{pageNumber:2,text:'Evidence'},{pageNumber:'3'},{pageNumber:0},{page:1},null]}});
  });
  const result=await askDocumentQuestion('server-id','What matters?');
  assert.equal(result.answer,'A grounded answer.');
  assert.deepEqual(result.sources.map(s=>s.page),[2,3,null,1]);
  assert.equal(result.sources[0].documentId,'server-id');
});

test('server failures retain actionable messages', async t => {
  mockFetch(t,async()=>json({message:'Index this document first.'},409));
  await assert.rejects(askDocumentQuestion('id','Why?'),/Index this document first/);
});

test('populated document objects and malformed citations cannot become React children', async t => {
  mockFetch(t,async()=>json({data:{answer:'A grounded answer.',sources:[
    null,
    {document:{_id:'server-id',originalName:'Guide.pdf'},pageNumber:2,content:'Source excerpt'},
    {document:{unexpected:true},pageNumber:{unexpected:true}},
    {document:['bad label'],pageNumber:true},
  ]}}));
  const result=await askDocumentQuestion('server-id','What matters?');
  assert.equal(result.sources[0].document,'Guide.pdf');
  assert.equal(result.sources[0].documentId,'server-id');
  assert.equal(result.sources[0].text,'Source excerpt');
  assert.deepEqual(result.sources.map(source=>source.page),[2,null,null]);
  assert(result.sources.every(source=>source.document===undefined||typeof source.document==='string'));
});

test('old saved histories retain text while repairing malformed sources and timestamps', () => {
  const messages=normalizeMessages([
    null,
    {role:'assistant',content:'Saved answer',sources:{length:1},timestamp:{toString:'invalid'}},
    {role:'assistant',content:'Another answer',sources:[null,{document:{originalName:'Guide.pdf'},page:3}],timestamp:1234},
    {role:'user',content:{invalid:true}},
  ],'server-id');
  assert.equal(messages.length,2);
  assert.equal(messages[0].content,'Saved answer');
  assert.deepEqual(messages[0].sources,[]);
  assert.equal(messages[0].timestamp,null);
  assert.equal(messages[1].sources[0].document,'Guide.pdf');
  assert.equal(messages[1].sources[0].page,3);
  assert.equal(messages[1].timestamp,1234);
  assert.deepEqual(normalizeMessages({length:1}),[]);
});

test('network, malformed JSON, missing answers, and invalid lists fail explicitly', async t => {
  let handler=async()=>{throw new TypeError('Failed to fetch')};
  mockFetch(t,(...args)=>handler(...args));
  await assert.rejects(request('/documents'),/Cannot reach the document server/);
  handler=async()=>new Response('<html>Proxy error</html>',{status:502});
  await assert.rejects(request('/documents'),/unexpected response \(502\)/);
  handler=async()=>json({data:{answer:null}});
  await assert.rejects(askDocumentQuestion('id','Why?'),/no answer/);
  handler=async()=>json({data:{}});
  await assert.rejects(getDocuments(),/invalid document list/);
});


test('simultaneous unauthorized requests share one refresh and retry with cookies', async t => {
  resetCredentials();
  let refreshed = false, refreshes = 0;
  mockFetch(t, async (url, options) => {
    assert.equal(options.credentials, 'include');
    if (url.endsWith('/auth/me')) return json({ message: 'Expired' }, 401);
    if (url.endsWith('/auth/refresh')) { refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); refreshed = true; return json({ success: true }); }
    return refreshed ? json({ data: [] }) : json({ message: 'Expired' }, 401);
  });
  await Promise.all([request('/documents'), request('/documents')]);
  assert.equal(refreshes, 1);
});

test('auth/me can refresh expired sessions while invalid login never refreshes', async t => {
  let refreshed = false, refreshes = 0;
  mockFetch(t, async url => {
    if (url.endsWith('/auth/refresh')) { refreshed = true; refreshes++; return json({ success: true }); }
    if (url.endsWith('/auth/me')) return refreshed ? json({ data: { user: { id: 'user-a' } } }) : json({ message: 'Expired' }, 401);
    return json({ message: 'Invalid email or password' }, 401);
  });
  assert.equal((await request('/auth/me')).data.user.id, 'user-a');
  await assert.rejects(request('/auth/login', { method: 'POST', body: '{}' }), /Invalid email or password/);
  assert.equal(refreshes, 1);
});
