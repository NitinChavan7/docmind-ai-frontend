import { BookOpen, FileUp, ArrowUpRight, ShieldCheck, FileText, MessageSquare, ScanText } from 'lucide-react';

const steps = [
  { icon: FileText, title: 'Open a PDF', text: 'Preview it without an account.' },
  { icon: MessageSquare, title: 'Ask about your document', text: 'Sign in to start a conversation.' },
  { icon: ScanText, title: 'Review references', text: 'Check answers against cited pages.' },
];

export default function GuestWelcome({ onUpload, uploading }) {
  return <section className="guest-welcome" aria-labelledby="guest-welcome-title">
    <div className="guest-welcome-inner">
      <div className="guest-welcome-layout">
        <div className="guest-welcome-copy">
          <span className="guest-welcome-kicker"><BookOpen size={14}/>PDF DOCUMENT ASSISTANT</span>
          <h1 id="guest-welcome-title">Read your PDFs.<br/><em>Find answers.</em></h1>
          <p>Ask questions, get clear answers and check the source. Start by opening a PDF — no account needed to preview.</p>
          <div className="guest-welcome-actions"><button className="primary-button" onClick={onUpload} disabled={uploading}><FileUp size={18}/>{uploading ? 'Opening your PDF...' : 'Upload a PDF'}<ArrowUpRight size={17}/></button><span>Free PDF preview · Files up to 10 MB</span></div>
        </div>
        <div className="guest-welcome-visual" aria-hidden="true">
          <div className="guest-preview-paper"><span className="guest-preview-eyebrow">DOCUMENT OVERVIEW</span><span className="guest-preview-title">Project brief<br/><em>Key findings.</em></span><div className="guest-preview-lines"><i/><i/><i/></div><div className="guest-preview-highlight">Review findings against the source.</div><div className="guest-preview-lines"><i/><i/><i/><i/></div><span className="guest-preview-page">DOCUMENT PREVIEW / 01</span></div>
          <span className="guest-preview-caption"><BookOpen size={17}/>Answers with page references</span>
        </div>
      </div>
      <div className="guest-welcome-steps">{steps.map(({ icon: Icon, title, text }, index) => <div key={title} className="guest-welcome-step"><span className="guest-step-icon"><Icon size={18}/></span><div><strong><span>{index + 1}.</span> {title}</strong><p>{text}</p></div></div>)}</div>
      <p className="guest-welcome-privacy"><ShieldCheck size={15}/><span>Your PDF stays on this device until you sign in.</span></p>
    </div>
  </section>;
}
