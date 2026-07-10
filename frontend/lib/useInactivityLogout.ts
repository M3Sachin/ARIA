import { useEffect, useRef, useCallback } from "react";

const ACTIVITY_EVENTS = [
  "mousemove", "mousedown", "keydown",
  "touchstart", "touchmove", "scroll",
  "click",
] as const;

const WARNING_BEFORE_MS = 60_000;

interface Options {
  timeoutMs: number;
  onLogout: () => void;
  onWarning?: () => void;
  onReset?: () => void;
}

export function useInactivityLogout({ timeoutMs, onLogout, onWarning, onReset }: Options) {
  const logoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onLogoutCb  = useRef(onLogout);
  const onWarningCb = useRef(onWarning);
  const onResetCb   = useRef(onReset);

  useEffect(() => { onLogoutCb.current  = onLogout;  }, [onLogout]);
  useEffect(() => { onWarningCb.current = onWarning; }, [onWarning]);
  useEffect(() => { onResetCb.current   = onReset;   }, [onReset]);

  const schedule = useCallback(() => {
    if (logoutRef.current)  clearTimeout(logoutRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);

    if (timeoutMs > WARNING_BEFORE_MS) {
      warningRef.current = setTimeout(
        () => onWarningCb.current?.(),
        timeoutMs - WARNING_BEFORE_MS,
      );
    }

    logoutRef.current = setTimeout(() => onLogoutCb.current(), timeoutMs);
  }, [timeoutMs]);

  const onActivity = useCallback(() => {
    onResetCb.current?.();
    schedule();
  }, [schedule]);

  useEffect(() => {
    schedule();
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      if (logoutRef.current)  clearTimeout(logoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, onActivity));
    };
  }, [schedule, onActivity]);
}
