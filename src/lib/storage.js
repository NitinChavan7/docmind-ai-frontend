import { normalizeMessages } from './chat.js';

const DB_NAME='docmind-files-v1';
const STORE='documents';
function openDb(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'})};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}
async function transaction(mode,action){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode);
  let result;
  const request=action(tx.objectStore(STORE));
  request.onsuccess=()=>{result=request.result};
  tx.oncomplete=()=>{db.close();resolve(result)};
  tx.onerror=()=>{db.close();reject(tx.error||request.error)};
  tx.onabort=()=>{db.close();reject(tx.error||new Error('Browser storage operation was interrupted.'))};
 });
}
export const listStoredDocuments=()=>transaction('readonly',s=>s.getAll());
export const saveDocument=doc=>transaction('readwrite',s=>s.put(doc));
export const deleteStoredDocument=id=>transaction('readwrite',s=>s.delete(id));
const CHAT_KEY='docmind-chats-v1';
export function readChats(){
 try{
  const value=JSON.parse(localStorage.getItem(CHAT_KEY)||'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([,messages])=>Array.isArray(messages)).map(([id,messages])=>[id,normalizeMessages(messages)]));
 }catch{return {}}
}
export function writeChats(value){localStorage.setItem(CHAT_KEY,JSON.stringify(value))}
