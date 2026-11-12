import { useEffect, useRef, useState } from 'react';

// Fetches each clip once, into memory, and hands back object URLs keyed by
// the original src. A <video> on an object URL needs no network at all, so
// seeks and pauses are instant on every phone. Starts as soon as the page
// knows the list (the lobby), long before the question comes up.
// onLoaded(src) fires when a clip is in.
export function usePreload(srcs, onLoaded) {
  const [ready, setReady] = useState({});
  const started = useRef(new Set());
  const cb = useRef(onLoaded);
  cb.current = onLoaded;
  useEffect(() => {
    for (const src of srcs || []) {
      if (started.current.has(src)) continue;
      started.current.add(src);
      fetch(src)
        .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.blob(); })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          setReady((m) => ({ ...m, [src]: url }));
          cb.current?.(src);
        })
        .catch((e) => { console.warn('preload failed, will stream instead', src, e); started.current.delete(src); });
    }
  }, [srcs]);
  return ready;
}
