import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { request, resetCredentials, fetchPrivatePdf, API_BASE } from '../src/services/http.js';
import { login, register, googleLogin, getAuthConfig, getCurrentUser, logout } from '../src/services/authApi.js';
import { createChat, getCandidateChats, getChatMessages, sendChatMessage } from '../src/services/chatApi.js';
import { friendlyError, validateAuthFields } from '../src/lib/errors.js';
import { chooseRememberedDocument, rememberDocument, readSelectedDocument } from '../src/lib/workspaceState.js';

test('account validation explains missing and invalid fields without blocking existing short passwords', () => {
  assert.deepEqual(Object.keys(validateAuthFields({}, true)), ['name', 'email', 'password']);
  assert.match(validateAuthFields({ email: 'unfinished@', password: 'validpass' }, false).email, /complete email/);
  assert.match(validateAuthFields({ name: 'Sam', email: 'sam@example.com', password: 'short' }, true).password, /at least 8/);
  assert.deepEqual(validateAuthFields({ email: 'sam@example.com', password: 'short' }, false), {});
  assert.match(validateAuthFields({ email: 'sam@example.com', password: '界'.repeat(25) }, false).password, /shorter/);
});

test('user-facing failures hide server internals and give contextual next steps', () => {
  const internal = 'MongoServerError: secret backend trace';
  for (const context of ['login', 'register', 'google', 'logout', 'upload', 'index', 'documents', 'history', 'chat', 'pdf', 'delete']) {
    assert.equal(friendlyError({ status: 500, message: internal }, context).includes(internal), false);
  }
  assert.match(friendlyError({ status: 401 }, 'login'), /email and password don't match/);
  assert.match(friendlyError({ status: 409 }, 'register'), /original method/);
  assert.match(friendlyError({ status: 413 }, 'upload'), /under 10 MB/);
  assert.match(friendlyError({ code: 'REQUEST_TIMEOUT' }, 'chat'), /longer than expected/);
  assert.match(friendlyError({ status: 503 }, 'index'), /still read it/);
});

const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const profile={id:'user-id',name:'Test Researcher',email:'test@example.com',provider:'local'};
beforeEach(()=>resetCredentials());
function withCsrf(t, handler) {
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.credentials,'include');
    if(url.endsWith('/auth/csrf'))return json({data:{csrfToken:'csrf'}});
    return handler(url,options);
  });
}

test('authentication uses cookie requests and validates the returned profile',async t=>{
  const paths=[];
  withCsrf(t,async(url,options)=>{
    paths.push(url.replace(API_BASE,''));
    if(options.method==='POST')assert.equal(options.headers.get('X-CSRF-Token'),'csrf');
    return json({success:true,data:{user:profile}});
  });
  assert.equal((await login('test@example.com','fixture-password')).id,'user-id');
  assert.equal((await register('Test Researcher','test@example.com','fixture-password')).name,'Test Researcher');
  assert.equal((await googleLogin('fixture-id-token')).email,'test@example.com');
  assert.equal((await getCurrentUser()).id,'user-id');
  await logout();
  assert.deepEqual(paths,['/auth/login','/auth/register','/auth/google','/auth/me','/auth/logout']);
});

test('simultaneous expired JSON and PDF requests share one refresh and retry once',async t=>{
  let refreshed=false,refreshCount=0;
  withCsrf(t,async url=>{
    if(url.endsWith('/auth/me'))return json({message:'Expired'},401);
    if(url.endsWith('/auth/refresh')){refreshCount++;await new Promise(resolve=>setTimeout(resolve,5));refreshed=true;return json({success:true});}
    if(!refreshed)return json({message:'Expired'},401);
    if(url.endsWith('/view'))return new Response('%PDF-1.4',{headers:{'Content-Type':'application/pdf'}});
    return json({data:[]});
  });
  const results=await Promise.all([request('/documents'),request('/chats?documentId=id'),fetchPrivatePdf(API_BASE+'/documents/id/view')]);
  assert.equal(refreshCount,1);
  assert.equal(await results[2].text(),'%PDF-1.4');
});

test('a rejected refresh does not loop or replay a protected request',async t=>{
  let refreshCount=0,documentCount=0;
  withCsrf(t,async url=>{
    if(url.endsWith('/auth/refresh'))refreshCount++;
    if(url.endsWith('/documents'))documentCount++;
    return json({message:'Session expired'},401);
  });
  await assert.rejects(request('/documents'),error=>error.status===401);
  assert.equal(refreshCount,1);assert.equal(documentCount,1);
});

test('invalid CSRF tokens are fetched again and retried only once',async t=>{
  let tokens=0,posts=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.endsWith('/auth/csrf'))return json({data:{csrfToken:'csrf-'+(++tokens)}});
    posts++;
    assert.equal(options.headers.get('X-CSRF-Token'),'csrf-'+posts);
    return posts===1?json({code:'CSRF_INVALID'},403):json({success:true});
  });
  await request('/chats',{method:'POST',body:'{}'});
  assert.equal(tokens,2);assert.equal(posts,2);
});

test('wrong login credentials are returned without token refresh',async t=>{
  let refreshCount=0;
  withCsrf(t,async url=>{if(url.endsWith('/auth/refresh'))refreshCount++;return json({message:'Invalid credentials'},401);});
  await assert.rejects(login('test@example.com','wrong'),/Invalid credentials/);
  assert.equal(refreshCount,0);
});

test('Google uses the backend public client ID and sends only the ID credential',async t=>{
  const calls=[];
  withCsrf(t,async(url,options)=>{
    calls.push(url);
    if(url.endsWith('/auth/config'))return json({data:{googleClientId:' 12345-fixture.apps.googleusercontent.com '}});
    assert.deepEqual(JSON.parse(options.body),{credential:'fixture-google-id-token'});
    return json({data:{user:{...profile,provider:'google'}}});
  });
  assert.equal((await getAuthConfig()).googleClientId,'12345-fixture.apps.googleusercontent.com');
  assert.equal((await googleLogin('fixture-google-id-token')).provider,'google');
  await assert.rejects(googleLogin(''),/did not return/);
  assert.equal(calls.length,2);
});

test('missing or malformed Google configuration does not initialize the SDK',async t=>{
  withCsrf(t,async()=>json({data:{googleClientId:{invalid:true}}}));
  assert.equal((await getAuthConfig()).googleClientId,'');
});

test('aborted reads and responses from an old identity cannot update a new session',async t=>{
  const controller=new AbortController();controller.abort();
  let calls=0;
  withCsrf(t,async()=>{calls++;return json({data:[]});});
  await assert.rejects(request('/documents',{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(calls,0);
  t.mock.method(globalThis,'fetch',async()=>{resetCredentials();return new Response('%PDF-1.4',{headers:{'Content-Type':'application/pdf'}});});
  await assert.rejects(fetchPrivatePdf(API_BASE+'/documents/id/view'),error=>error.code==='SESSION_CHANGED');
});

test('conversation services support server histories and direct saved message responses',async t=>{
  const calls=[];
  withCsrf(t,async(url,options)=>{
    const path=url.replace(API_BASE,'');calls.push(path);
    if(path==='/chats')return json({data:{_id:'chat-id',documentId:'doc-id',title:'New conversation'}});
    if(path.startsWith('/chats?'))return json({data:[{_id:'chat-id',documentId:'doc-id',title:'Saved conversation'}]});
    if(options.method==='POST'){
      assert.deepEqual(JSON.parse(options.body),{question:'What matters?',requestId:'request-id'});
      return json({data:{chatId:'chat-id',userMessage:{_id:'user-message',role:'user',content:'What matters?',createdAt:'2026-11-06T12:00:00Z'},assistantMessage:{_id:'answer-id',role:'assistant',content:'The answer.',sources:[{pageNumber:2}]}}});
    }
    return json({data:[{_id:'answer-id',role:'assistant',content:'Saved answer',sources:[{pageNumber:2}]}],pagination:{hasMore:true,before:'cursor-id'}});
  });
  assert.equal((await createChat('doc-id'))._id,'chat-id');
  assert.equal((await getCandidateChats('doc-id'))[0].documentId,'doc-id');
  const history=await getChatMessages('chat-id','older');
  assert.equal(history.data[0].id,'answer-id');assert.equal(history.pagination.before,'cursor-id');
  const turn=await sendChatMessage('chat-id','What matters?','request-id');
  assert.equal(turn.userMessage.id,'user-message');
  assert.equal(turn.userMessage.timestamp,Date.parse('2026-11-06T12:00:00Z'));
  assert.equal(turn.assistantMessage.sources[0].page,2);
  assert(calls.includes('/chats/chat-id/messages?limit=50&before=older'));
});

test('conversation ownership and malformed server payloads fail explicitly',async t=>{
  withCsrf(t,async()=>json({data:[{_id:'chat-id',documentId:'other-document'}]}));
  await assert.rejects(getCandidateChats('doc-id'),/another document/);
  await assert.rejects(sendChatMessage('chat-id','Question?'),/incomplete answer/);
});


test('workspace selection survives reload, stays account-specific and ignores removed document IDs', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const entries = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'sessionStorage', original); else delete globalThis.sessionStorage; });
  const docs = [{ id: 'newest' }, { id: 'selected' }];
  rememberDocument('account-a', 'selected');
  rememberDocument('guest', 'local-preview');
  assert.equal(chooseRememberedDocument(docs, 'account-a'), 'selected');
  assert.equal(chooseRememberedDocument(docs, 'account-b'), 'newest');
  assert.equal(readSelectedDocument('guest'), 'local-preview');
  assert.equal(chooseRememberedDocument([{ id: 'newest' }], 'account-a'), 'newest');
  assert.equal(chooseRememberedDocument([], 'account-a'), null);
});

test('blocked browser storage does not prevent opening a workspace', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage is blocked'); } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'sessionStorage', original); else delete globalThis.sessionStorage; });
  assert.doesNotThrow(() => rememberDocument('account-a', 'selected'));
  assert.equal(readSelectedDocument('account-a'), null);
  assert.equal(chooseRememberedDocument([{ id: 'first' }], 'account-a'), 'first');
});
