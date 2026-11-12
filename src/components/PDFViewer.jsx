import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { FileUp, FileText, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Download, Expand, RotateCcw, Maximize2, MoreHorizontal } from 'lucide-react';
import { fetchPrivatePdf } from '../services/http.js';
import { friendlyError } from '../lib/errors.js';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

function DocumentOpening({ name }) {
  return <div className="document-opening" role="status">
    <span className="document-opening-icon"><FileText size={23} strokeWidth={1.5}/></span>
    <strong>Opening your document</strong><span className="document-opening-name">{name}</span>
    <div className="document-skeleton" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>
  </div>;
}

export default function PDFViewer({ doc, onUpload, goToPage, apiMode, guestMode, expired, uploadReason, onError }) {
  const [loaded, setLoaded] = useState({ id: null, pages: 0 });
  const [page, setPage] = useState(1), [scale, setScale] = useState(1), [width, setWidth] = useState(680);
  const [resource, setResource] = useState({ id: null, url: null, error: '' });
  const [retry, setRetry] = useState(0);
  const [renderedPage, setRenderedPage] = useState('');
  const scroll = useRef(null), tools = useRef(null);
  useEffect(() => {
    const close = event => { if (tools.current && !tools.current.contains(event.target)) tools.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const pages = loaded.id === doc?.id ? loaded.pages : 0;
  const pdfUrl = resource.id === doc?.id ? resource.url : null;
  const fileError = resource.id === doc?.id ? resource.error : '';

  useEffect(() => {
    if (!doc || expired) return;
    const controller = new AbortController();
    let objectUrl;
    setResource({ id: doc.id, url: null, error: '' });
    (async () => {
      try {
        const blob = doc.file || await fetchPrivatePdf(doc.fileUrl, controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setResource({ id: doc.id, url: objectUrl, error: '' });
      } catch (error) {
        if (!controller.signal.aborted) { setResource({ id: doc.id, url: null, error: friendlyError(error, 'pdf') }); onError?.(error); }
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc?.id, doc?.fileUrl, doc?.file, retry, expired]);

  useEffect(() => { setPage(1); setScale(1); scroll.current?.scrollTo(0, 0); }, [doc?.id]);
  useEffect(() => {
    if (Number.isInteger(goToPage?.page) && goToPage.page > 0 && pages > 0) {
      setPage(Math.min(goToPage.page, pages)); scroll.current?.scrollTo(0, 0);
    }
  }, [goToPage, pages]);
  useEffect(() => {
    const node = scroll.current;
    if (!node) return;
    let frame;
    const observer = new ResizeObserver(entries => {
      const next = Math.max(180, Math.floor(entries[0].contentRect.width - 52));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(previous => Math.abs(previous - next) >= 2 ? next : previous));
    });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [doc?.id]);

  const changePage = delta => { setPage(previous => previous + delta); scroll.current?.scrollTo(0, 0); };
  const retryFile = () => { setLoaded({ id: null, pages: 0 }); setRetry(previous => previous + 1); };
  const errorView = <div role="alert" className="pdf-error"><FileText size={25}/><p>{fileError || 'We could not open this PDF. Please try loading it again.'}</p><button onClick={retryFile}><RotateCcw size={14}/> Retry document</button></div>;

  if (!doc) return <section className="viewer-section viewer-empty"><div className="empty-visual"><FileText size={48} strokeWidth={1}/></div><h2>Upload a PDF to begin</h2><p>Read a document, ask questions and review cited pages in the same workspace.</p><button className="primary-button" disabled={Boolean(uploadReason)} title={uploadReason} onClick={onUpload}><FileUp size={17}/> Upload a PDF</button><div className="empty-caption">{uploadReason || (guestMode ? 'PDF up to 10 MB - No sign-in needed to preview' : apiMode ? 'PDF uploads follow your account limits'  : 'PDF files up to 20 MB - Stored in your browser')}</div></section>;
  if (expired) return <section className="viewer-section viewer-empty"><FileText size={32}/><h2>This document has expired.</h2><p>Refresh your library or upload the PDF again to continue. Expiry does not confirm that cloud storage cleanup has finished.</p><button className="primary-button" disabled={Boolean(uploadReason)} onClick={onUpload}>Upload a PDF</button></section>;
  return <section className="viewer-section" aria-label="PDF reader">
    <div className="pdf-toolbar">
      <div className="pdf-title"><span className="pdf-title-icon"><FileText size={16}/></span><div><strong title={doc.name}>{doc.name}</strong><small>{doc.sample ? 'SAMPLE DOCUMENT' : 'PDF DOCUMENT'}</small></div></div>
      <div className="pdf-actions" role="group" aria-label="PDF controls">
        <div className="page-controls"><button className="tool-button" disabled={page <= 1 || !pages} onClick={() => changePage(-1)} title="Previous page"><ChevronLeft size={14}/></button><form className="page-jump" onSubmit={event => { event.preventDefault(); const field = event.currentTarget.elements.page; const value = Math.trunc(Number(field.value)); if (value >= 1 && value <= pages) { setPage(value); scroll.current?.scrollTo(0, 0); } else field.value = page; field.blur(); }}><input key={page} name="page" aria-label="Page number" type="number" min={1} max={pages || 1} defaultValue={page} disabled={!pages} onBlur={event => { event.currentTarget.value = page; }}/><span>/ {pages || '-'}</span></form><button className="tool-button" disabled={page >= pages || !pages} onClick={() => changePage(1)} title="Next page"><ChevronRight size={14}/></button></div>
        <div className="toolbar-divider"/>
        <div className="pdf-zoom-controls" role="group" aria-label="Zoom controls">
          <button className="tool-button" disabled={scale <= .6} onClick={() => setScale(value => Math.max(.6, Math.round((value - .1) * 10) / 10))} aria-label="Zoom out" data-tooltip="Zoom out"><ZoomOut size={15}/></button><span className="zoom-label" role="status" aria-label={`Zoom ${Math.round(scale * 100)} percent`}>{Math.round(scale * 100)}%</span>
          <button className="tool-button" disabled={scale >= 2} onClick={() => setScale(value => Math.min(2, Math.round((value + .1) * 10) / 10))} aria-label="Zoom in" data-tooltip="Zoom in"><ZoomIn size={15}/></button>
        </div>
        <div className="toolbar-divider" aria-hidden="true"/>
        <button className="tool-button fit-width pdf-fit-direct" disabled={!pages} onClick={() => setScale(1)} data-tooltip="Fit to width" aria-label="Fit to width"><Maximize2 size={14}/></button>
        <details ref={tools} className="pdf-more" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus(); } }}>
          <summary className="tool-button" aria-label="More PDF tools" data-tooltip="More tools"><MoreHorizontal size={18}/></summary>
          <div className="pdf-more-menu">
            <button className="pdf-fit-menu" disabled={!pages} onClick={event => { setScale(1); event.currentTarget.closest('details').open = false; }}><Maximize2 size={15}/>Fit to width</button>
            <a href={pdfUrl || undefined} aria-disabled={!pdfUrl} download={doc.name} onClick={event => { event.currentTarget.closest('details').open = false; }}><Download size={15}/>Download PDF</a>
            <a href={pdfUrl || undefined} aria-disabled={!pdfUrl} target="_blank" rel="noreferrer" onClick={event => { event.currentTarget.closest('details').open = false; }}><Expand size={15}/>Open in new tab</a>
          </div>
        </details>
      </div>
    </div>
    <div className="pdf-scroll" ref={scroll}>
      {fileError ? errorView : !pdfUrl ? <DocumentOpening name={doc.name}/> :
        <Document file={pdfUrl} onLoadSuccess={({ numPages }) => setLoaded({ id: doc.id, pages: numPages })} loading={<DocumentOpening name={doc.name}/>} error={errorView}>
          <div className={`page-paper ${renderedPage === doc.id + ':' + page ? 'is-rendered' : ''}`}><Page onRenderSuccess={() => setRenderedPage(doc.id + ':' + page)} pageNumber={page} width={Math.floor(Math.min(width, 780) * scale)} devicePixelRatio={Math.min(window.devicePixelRatio || 1, 2)} renderTextLayer renderAnnotationLayer loading={<DocumentOpening name={doc.name}/>}/></div>
        </Document>}
    </div>
    <div className="viewer-status"><span>{doc.sample ? 'Sample document' : doc.guest ? 'Local preview - Sign in when you ask a question' : doc.remote ? 'Saved to your account' : 'Saved in your browser'}</span><span>Page {page} of {pages || '...'}</span></div>
  </section>;
}
