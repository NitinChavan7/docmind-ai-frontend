import { useEffect, useRef } from 'react';
import { GripVertical } from 'lucide-react';

export default function WorkspaceDivider({ width, onChange }) {
  const cleanup = useRef(null);
  useEffect(() => () => cleanup.current?.(), []);
  const resize = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanup.current?.();
    const startX = event.clientX, startWidth = width;
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);
    node.classList.add('is-resizing');
    const move = e => onChange(Math.max(400, Math.min(720, startWidth + startX - e.clientX)));
    const stop = () => {
      node.classList.remove('is-resizing');
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', stop);
      node.removeEventListener('pointercancel', stop);
      cleanup.current = null;
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', stop);
    node.addEventListener('pointercancel', stop);
    cleanup.current = stop;
  };
  return <div className="workspace-divider" role="separator" aria-label="Resize assistant panel" aria-orientation="vertical" aria-valuemin={400} aria-valuemax={720} aria-valuenow={width} tabIndex={0} onPointerDown={resize} onKeyDown={event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      onChange(event.key === 'Home' ? 400 : event.key === 'End' ? 720 : Math.max(400, Math.min(720, width + (event.key === 'ArrowLeft' ? 24 : -24))));
    }
  }} title="Drag to resize · Arrow keys to adjust"><GripVertical size={13}/></div>;
}
