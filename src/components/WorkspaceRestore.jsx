import { BookOpen, LoaderCircle, RotateCcw } from 'lucide-react';

export default function WorkspaceRestore({ error, onRetry }) {
  if (!error) return <main className="workspace-loading-layout" aria-label="Loading document workspace" aria-busy="true">
    <aside className="workspace-loading-sidebar" aria-hidden="true">
      <div className="workspace-loading-brand"><BookOpen size={24} strokeWidth={1.5}/><span>docmind</span></div>
      <span className="workspace-loading-upload"/>
      <span className="workspace-loading-line"/>
      <div className="workspace-loading-library">{[0, 1, 2].map(item => <div key={item}><i/><span><b/><b/></span></div>)}</div>
    </aside>
    <div className="workspace-loading-main">
      <header className="workspace-loading-header"><span className="workspace-loading-brand"><BookOpen size={21} strokeWidth={1.5}/><span>docmind</span></span><span className="workspace-loading-location">Document studio</span><span className="workspace-loading-status" role="status"><LoaderCircle size={14} className="spinner"/>Loading workspace...</span></header>
      <div className="workspace-loading-toolbar" aria-hidden="true"><i/><span/><b/></div>
      <div className="workspace-loading-panels" aria-hidden="true">
        <section className="workspace-loading-reader"><div className="workspace-loading-panel-header"><i/><span/></div><div className="workspace-loading-paper"><b/>{[0, 1, 2].map(item => <div key={item}><i/><i/><i/><i/></div>)}</div></section>
        <section className="workspace-loading-chat"><div className="workspace-loading-panel-header"><i/><span/></div><div className="workspace-loading-answer"><i/><i/><i/></div><div className="workspace-loading-composer"/></section>
      </div>
    </div>
  </main>;
  return <main className="workspace-restore">
    <div className="workspace-restore-brand"><BookOpen size={26} strokeWidth={1.5}/><span>docmind</span></div>
    <section role="alert">
      <span className="workspace-restore-icon"><RotateCcw size={24}/></span>
      <h1>Unable to open your workspace</h1>
      <p>{error}</p>
      <button onClick={onRetry}><RotateCcw size={15}/>Try again</button>
    </section>
  </main>;
}
