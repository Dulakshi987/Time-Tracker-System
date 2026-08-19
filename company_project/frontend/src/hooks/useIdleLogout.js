import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentUser, logoutUser } from "../config/permissions";

// ── Config ───────────────────────────────────────────────────────────────
const IDLE_LIMIT_MS = 10 * 60 * 1000; // 10 minutes
const ACTIVITY_EVENTS = [
  "mousedown",
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "click",
];

/**
 * Auto-logs the user out after IDLE_LIMIT_MS of no activity.
 * Mounted once in App() so it applies across every protected route.
 */
export default function useIdleLogout() {
  const navigate = useNavigate();
  const timerRef = useRef(null);

  const doLogout = useCallback(() => {
    // Only act if someone is actually logged in — avoids redirect loops
    // on the login page itself.
    if (!getCurrentUser()) return;
    logoutUser();
    navigate("/", {
      replace: true,
      state: { reason: "idle-timeout" },
    });
  }, [navigate]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Don't bother arming the timer if nobody's logged in
    if (!getCurrentUser()) return;
    timerRef.current = setTimeout(doLogout, IDLE_LIMIT_MS);
  }, [doLogout]);

  useEffect(() => {
    resetTimer(); // arm on mount

    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, resetTimer, { passive: true })
    );

    // Cross-tab: if another tab logs out, clear this tab's timer too
    const onStorage = (e) => {
      if (e.key === "fentons_user" && e.newValue === null) {
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, resetTimer)
      );
      window.removeEventListener("storage", onStorage);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);
}