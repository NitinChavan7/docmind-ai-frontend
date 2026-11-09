import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({ children, labelledBy, describedBy, onClose, busy, returnFocusRef, className = '', role = 'alertdialog' }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement;
    node.showModal();
    node.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
    return () => {
      node.close();
      const target = returnFocusRef?.current || previous;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);
  return createPortal(<dialog ref={dialog} className={`account-dialog ${className}`} role={role} aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const elements = [...event.currentTarget.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')];
    if (!elements.length) { event.preventDefault(); return; }
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget || busy) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>{children}</dialog>, document.body);
}
