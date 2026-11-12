import { Fragment, memo } from 'react';

// A small, deliberately text-only renderer: model output never becomes HTML.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) =>
    part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part.startsWith('`') ? <code key={index}>{part.slice(1, -1)}</code>
        : <Fragment key={index}>{part}</Fragment>);
}

function AnswerContent({ text }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  return <div className="answer-content">{blocks.map((block, index) => {
    const lines = block.split('\n');
    if (lines.every(line => /^\s*[-*•]\s+/.test(line))) {
      return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*[-*•]\s+/, ''))}</li>)}</ul>;
    }
    if (lines.every(line => /^\s*\d+[.)]\s+/.test(line))) {
      return <ol key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>)}</ol>;
    }
    return <div className="answer-paragraph" key={index}>{lines.map((line, i) => /^#{1,6}\s+/.test(line)
      ? <h4 key={i}>{inline(line.replace(/^#{1,6}\s+/, ''))}</h4>
      : <Fragment key={i}>{i > 0 && <br/>}{inline(line)}</Fragment>)}</div>;
  })}</div>;
}

export default memo(AnswerContent);
