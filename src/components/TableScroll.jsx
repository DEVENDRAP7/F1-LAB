import { useCallback, useEffect, useRef, useState } from 'react';

/* A table that is wider than the phone it is on.
 *
 * Sixteen tables on this site scroll sideways below about 700px, and
 * measured at 390px they were hiding between 18 and 482 pixels of their
 * own content with nothing on screen to say so. A column cut off flush
 * at the container edge does not look cut off; it looks like the last
 * column. So a reader on a phone was being shown a qualifying table and
 * silently denied its gap column.
 *
 * The affordance is a fade at whichever edge still has content behind
 * it — both edges mid-scroll, neither when the table fits. It has to be
 * measured rather than assumed, because the same table overflows on a
 * phone and fits on a laptop, and because a `<details>` that opens or a
 * round that changes the row count changes the answer without a resize.
 *
 * Hence a ResizeObserver on both the scroller and its content: the
 * viewport resizing, the table's own width changing, and the container
 * being revealed inside a disclosure all land in the same callback.
 * Scroll position comes from the scroll event, which is passive because
 * this only ever reads.
 *
 * The fades are pointer-events: none in CSS — an affordance that eats
 * the drag that dismisses it is worse than no affordance. */
export default function TableScroll({ children, className = '', wide = false }) {
  const scroller = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const hidden = el.scrollWidth - el.clientWidth;
    // A pixel or two of hidden width is rounding, not content.
    if (hidden <= 2) {
      setEdges((prev) => (prev.left || prev.right ? { left: false, right: false } : prev));
      return;
    }
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft < hidden - 2;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    measure();

    el.addEventListener('scroll', measure, { passive: true });

    // Not every browser this has to work in has ResizeObserver; the
    // window resize is the coarse fallback, and the table still
    // scrolls either way.
    let observer;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
      if (el.firstElementChild) observer.observe(el.firstElementChild);
    }
    window.addEventListener('resize', measure);

    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, children]);

  const classes = [
    'table-scroll-wrap',
    edges.left ? 'has-left' : '',
    edges.right ? 'has-right' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div
        ref={scroller}
        className={['table-scroll', wide ? 'table-wide' : '', className]
          .filter(Boolean).join(' ')}
        // Scrolled with the keyboard as well as the finger, so it has to
        // be focusable and has to say what it is when focused.
        tabIndex={0}
        role="region"
        aria-label="Scrollable table"
      >
        {children}
      </div>
    </div>
  );
}
