import { useLayoutEffect, useState } from 'react';

// Portaled panels follow their trigger without being clipped by workspace panes.
export default function useAnchoredPanel(open, anchor, panel, placement = 'bottom', width = 350) {
  const [style, setStyle] = useState({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!open || !anchor || !panel.current) return;
    const update = () => {
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft || 0, y = viewport?.offsetTop || 0;
      const availableWidth = viewport?.width || innerWidth, availableHeight = viewport?.height || innerHeight;
      const bounds = anchor.getBoundingClientRect();
      const panelWidth = Math.min(width, availableWidth - 24);
      const height = Math.min(panel.current.scrollHeight, availableHeight - 24);
      const above = bounds.top - y - 20, below = y + availableHeight - bounds.bottom - 20;
      const upward = placement === 'top' ? above >= height || above > below : below < height && above > below;
      const maxHeight = Math.min(availableHeight - 24, Math.max(120, upward ? above : below));
      const top = upward ? bounds.top - Math.min(height, maxHeight) - 8 : bounds.bottom + 8;
      const left = placement === 'end' ? bounds.right - panelWidth : bounds.left;
      setStyle({ position: 'fixed', right: 'auto', bottom: 'auto', width: panelWidth,
        left: Math.max(x + 12, Math.min(left, x + availableWidth - panelWidth - 12)),
        top: Math.max(y + 12, Math.min(top, y + availableHeight - Math.min(height, maxHeight) - 12)),
        maxHeight, visibility: 'visible' });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel.current); observer.observe(anchor);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [open, anchor, panel, placement, width]);
  return style;
}
