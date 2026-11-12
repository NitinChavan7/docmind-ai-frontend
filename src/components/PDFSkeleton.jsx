export default function PDFSkeleton({ name, reader = false, width }) {
  const preview = <div className="pdf-preview-skeleton" role="status" aria-label={name ? `Loading PDF preview: ${name}` : 'Loading PDF preview'} style={width ? { width } : undefined}>
    <div className="pdf-skeleton-paper" aria-hidden="true">
      <div className="pdf-skeleton-heading"><i/><i/></div>
      {[0, 1, 2].map(section => <div className="pdf-skeleton-paragraph" key={section}><i/><i/><i/><i/><i/></div>)}
    </div>
    <span className="pdf-skeleton-caption">Loading PDF preview…</span>
  </div>;
  if (!reader) return preview;
  return <section className="viewer-section" aria-label="PDF reader" aria-busy="true">
    <div className="pdf-toolbar pdf-skeleton-toolbar" aria-hidden="true"><i/><i/></div>
    <div className="pdf-scroll">{preview}</div>
    <div className="viewer-status"><span>Preparing preview</span></div>
  </section>;
}
