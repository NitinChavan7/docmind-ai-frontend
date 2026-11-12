import { useEffect, useRef } from 'react';
import {BookOpen,Plus,Search,FileText,MessageSquare,Trash2,PanelLeftClose,PanelLeftOpen,ArrowUpRight,X,ShieldCheck,ChevronDown,RotateCcw,LoaderCircle} from 'lucide-react';
import { expiryLabel, isExpired, formatMB } from '../lib/usage.js';
import { getUserInitials } from '../lib/user.js';
const statusLabel=status=>({ready:'Ready to ask',processing:'Preparing PDF',uploaded:'Needs preparation',failed:'Preparation failed',error:'Preparation failed'}[status]||status);
export default function Sidebar({docs,activeId,onSelect,onUpload,onDelete,collapsed,onToggle,query,onQuery,chatCount,mobileOpen,onClose,apiMode,uploading,loading,loadError,onReload,onProcess,deletingId,pendingDocId,user,onOpenProfile,profileOpen,guestMode,onRequestSignIn,selectionLocked=false,usage,uploadReason,now,onPolicy}){
 const navigation=useRef(null), closeNavigation=useRef(onClose);
 closeNavigation.current=onClose;
 useEffect(()=>{
  if(!mobileOpen)return;
  const previous=document.activeElement;
  navigation.current?.querySelector('.mobile-close')?.focus();
  const keyboard=event=>{
   // Account dialogs are portalled outside the drawer and manage their own focus.
   if(document.querySelector('[role="dialog"]:not(.sidebar)'))return;
   if(event.key==='Escape'){event.preventDefault();closeNavigation.current();return;}
   if(event.key!=='Tab')return;
   const controls=[...navigation.current.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
   const first=controls[0],last=controls.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  document.addEventListener('keydown',keyboard);
  return()=>{document.removeEventListener('keydown',keyboard);if(!document.querySelector('[role="dialog"]:not(.sidebar)'))previous?.focus({preventScroll:true});};
 },[mobileOpen]);
 const compact=collapsed&&!mobileOpen;
 const filtered=docs.filter(d=>d.name.toLowerCase().includes(query.toLowerCase()));
 const mutating=uploading||!!deletingId;
 return <>
 {mobileOpen&&<button className="mobile-backdrop" onClick={onClose} aria-label="Close navigation"/>}
 <aside ref={navigation} aria-label="Document library" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen ? true : undefined} className={`sidebar ${compact?'collapsed':''} ${mobileOpen?'mobile-open':''}`}>
  <div className="sidebar-top"><div className="brand-mark"><BookOpen size={22} strokeWidth={1.6}/></div>{!compact&&<div className="brand-copy"><strong>docmind<span>®</span></strong></div>}<button className="icon-btn sidebar-toggle" onClick={onToggle} aria-label="Toggle sidebar">{compact?<PanelLeftOpen size={17}/>:<PanelLeftClose size={17}/>}</button><button className="icon-btn mobile-close" aria-label="Close navigation" onClick={onClose}><X size={19}/></button></div>
  <div className="sidebar-content">
   <button className="upload-button" disabled={uploading||loading||!!pendingDocId||Boolean(uploadReason)} aria-describedby={!compact ? 'upload-policy-note' : undefined} title={uploadReason || 'Upload PDFs'} onClick={onUpload}>{uploading?<LoaderCircle size={17} className="spinner"/>:<Plus size={17}/ >}{!compact&&<span>{uploading?'Adding your PDF...':'Upload document'}</span>}</button>
   {!compact&&<div className="upload-policy-note" id="upload-policy-note">
    <span>{usage ? `${formatMB(usage.limits.pdfSizeBytes)} per PDF / ${usage.limits.pdfPages} pages maximum` : guestMode ? 'Preview on this device. Sign in to ask questions.' : 'PDF page and storage limits are checked by the server.'}</span>
    {uploadReason&&<p>{uploadReason}</p>}
    {onPolicy&&<button onClick={onPolicy}>Limits &amp; retention</button>}
   </div>}
   {!compact&&<><div className="sidebar-search"><Search size={15}/><input value={query} onChange={e=>onQuery(e.target.value)} placeholder="Find a document..." aria-label="Search documents"/></div><div className="sidebar-section"><span>YOUR LIBRARY</span><span className="library-actions"><span className="section-count">{docs.length.toString().padStart(2,'0')}</span>{apiMode&&<button className="icon-btn" aria-label="Refresh documents" disabled={loading||mutating} onClick={onReload}><RotateCcw size={12}/></button>}</span></div></>}
   {!compact&&loading&&<div className="sidebar-empty" role="status">Loading your library…</div>}
   {!compact&&loadError&&<div className="library-error" role="alert"><p>{loadError}</p><button onClick={onReload} disabled={loading||mutating}>Retry loading documents</button></div>}
   <div className="file-list">{!filtered.length&&!compact&&!loading&&!loadError&&<div className="sidebar-empty">{docs.length?'No matching documents.':'No documents yet. Upload a PDF to begin.'}</div>}{filtered.map(d=><div key={d.id} className={`doc-item ${activeId===d.id?'active':''} ${isExpired(d,now)?'expired':''}`}><button className="doc-select" aria-current={activeId===d.id ? 'true' : undefined} onPointerEnter={() => import('./PDFViewer.jsx').catch(() => {})} onFocus={() => import('./PDFViewer.jsx').catch(() => {})} disabled={selectionLocked} title={d.name} onClick={()=>{onSelect(d.id);onClose()}}><span key={activeId===d.id ? 'selected' : 'idle'} className="doc-icon">{d.status==='processing'?<LoaderCircle size={18} className="spinner"/>:<FileText size={18}/>}</span>{!compact&&<span className="doc-text"><strong>{d.name.replace(/\.pdf$/i,'')}</strong><small className={d.status==='failed'||d.status==='error'?'status-failed':''}>{isExpired(d,now)?'Expired':d.guest?'Local preview':apiMode?statusLabel(d.status):d.sample?'Sample document':(d.size/1024/1024).toFixed(1)+' MB'} <span>·</span> PDF</small>{d.expiresAt&&<small className="expiry-label" title={new Date(d.expiresAt).toLocaleString()}>{expiryLabel(d.expiresAt,now)}</small>}</span>}</button>{!compact&&!d.sample&&<button className="doc-delete" disabled={!!deletingId||d.status==='processing'||pendingDocId===d.id} onClick={event=>onDelete(d,event.currentTarget)} aria-label={`Delete ${d.name}`}><Trash2 size={14}/></button>}</div>)}</div>
   {apiMode&&!compact&&docs.filter(d=>d.id===activeId&&!d.guest&&!isExpired(d,now)&&d.status!=='ready').map(d=><div className="index-notice" key={d.id}>{d.status==='processing'?<p>Preparing this PDF for questions. You can keep reading while it is prepared.</p>:<><p>{d.processingError||'Prepare this PDF to ask questions about its contents.'}</p><button disabled={loading||deletingId===d.id} onClick={()=>onProcess(d)}>Prepare document</button></>}</div>)}
   {!compact&&<div className="library-note"><MessageSquare size={15}/><span>{chatCount?chatCount+(apiMode?' messages loaded from your account':' messages saved in this browser'):'Document conversations'}</span></div>}
  </div>
  <div className="sidebar-bottom">{!compact&&<div className="privacy-card"><ShieldCheck size={19}/><strong>Document storage</strong><p>{guestMode?'Your PDF stays on this device.':apiMode?'Your PDFs are saved to your account.':'Your PDFs stay in this browser.'}<br/>{guestMode?'Sign in to ask document questions.':apiMode?'Conversations are saved to your account.':'Available in this browser only.'}</p><span>{guestMode?'GUEST PREVIEW':apiMode?'YOUR WORKSPACE':'LOCAL WORKSPACE'}<ArrowUpRight size={13}/></span></div>}<button className={`profile sidebar-profile ${profileOpen ? 'is-open' : ''}`} aria-haspopup={onOpenProfile ? "dialog" : undefined} aria-expanded={onOpenProfile ? Boolean(profileOpen) : undefined} disabled={!onOpenProfile&&!onRequestSignIn} onClick={onOpenProfile||onRequestSignIn} aria-label={guestMode?"Sign in to save your workspace":"View your profile"}><span className="avatar">{getUserInitials(user?.name,user?.email)}</span>{!compact&&<><div><strong>{user?.name||(guestMode?'Sign in to save documents':'My workspace')}</strong><small>{user?.email||(guestMode?'Access saved documents and chats':'Personal workspace')}</small></div><ChevronDown size={13}/></>}</button></div>
 </aside></>;
}

