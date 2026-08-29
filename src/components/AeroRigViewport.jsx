import { useEffect, useRef } from 'react';
import { createAeroRig } from '../lib/aeroRigScene.js';

// The 3D chamber. Three.js owns the canvas, the geometry and the render
// loop entirely — see aeroRigScene.js — this component only mounts it,
// forwards the aero-mode prop into it, and tears it down on unmount.
//
// The car itself never changes with the page's round/session/driver
// selection: it is one schematic diagram of the 2026 regulations, not a
// per-driver model. Only the gauges and the envelope chart around it
// vary with what is selected.
export default function AeroRigViewport({ mode, onPick, className }) {
  const canvasRef = useRef(null);
  const rigRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const rig = createAeroRig(canvasRef.current, {
      onPick: (part) => onPickRef.current(part),
    });
    rigRef.current = rig;
    return () => {
      rig.dispose();
      rigRef.current = null;
    };
    // Mounted once. onPick is read through a ref (below) so a new
    // function identity on every render never tears down and rebuilds
    // the WebGL context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    rigRef.current?.setMode(mode);
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-label="Interactive schematic of a 2026 Formula 1 car. Drag to orbit, scroll to zoom, click a part to inspect it."
    />
  );
}
