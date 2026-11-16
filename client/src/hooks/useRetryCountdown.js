// src/hooks/useRetryCountdown.js
// When the AI service says how long to wait (retry_after, in seconds), count
// down to it. start(seconds) begins a wait; waitSeconds is what's left (0 when
// there's no wait). onDone runs when the wait ends, e.g. to clear the error.
import { useEffect, useRef, useState } from "react";

export function useRetryCountdown(onDone) {
  const [waitUntil, setWaitUntil] = useState(0);  // ms timestamp; 0 = no wait
  const [now, setNow] = useState(() => Date.now());
  const done = useRef(onDone);
  done.current = onDone;

  // Tick once a second while a wait is running.
  useEffect(() => {
    if (!waitUntil) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= waitUntil) { setWaitUntil(0); done.current?.(); }
    }, 1000);
    return () => clearInterval(timer);
  }, [waitUntil]);

  // Start a wait from an axios error, if the server said how long.
  function startFromError(err) {
    const retryAfter = Number(err?.response?.data?.retry_after);
    if (retryAfter > 0) {
      const t = Date.now();
      setNow(t);
      setWaitUntil(t + retryAfter * 1000);
    }
  }

  const waitSeconds = waitUntil ? Math.max(0, Math.ceil((waitUntil - now) / 1000)) : 0;
  return { waitSeconds, waiting: waitSeconds > 0, startFromError };
}
