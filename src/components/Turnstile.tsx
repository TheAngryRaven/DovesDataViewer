import { useCallback, useEffect, useRef } from "react";

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

/** True when a Turnstile site key is configured. When false, callers should
 *  treat the captcha as satisfied (graceful fallback for self-hosters). */
export const turnstileEnabled = !!SITE_KEY;

interface TurnstileWidget {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
}

interface TurnstileProps {
  /** Receives the token on success, or null when reset/expired/errored. */
  onToken: (token: string | null) => void;
  theme?: "auto" | "light" | "dark";
  className?: string;
}

/**
 * Cloudflare Turnstile widget. Renders nothing (and never blocks) when no
 * `VITE_TURNSTILE_SITE_KEY` is set, so the app works without a captcha key.
 */
export function Turnstile({ onToken, theme = "auto", className }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY || document.getElementById("cf-turnstile-script")) return;
    const script = document.createElement("script");
    script.id = "cf-turnstile-script";
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    document.head.appendChild(script);
  }, []);

  const tryRender = useCallback((): boolean => {
    if (!SITE_KEY || !containerRef.current) return false;
    const ts = (window as unknown as { turnstile?: TurnstileWidget }).turnstile;
    if (!ts) return false;
    if (widgetId.current) {
      try { ts.remove(widgetId.current); } catch { /* already gone */ }
      widgetId.current = null;
    }
    onToken(null);
    widgetId.current = ts.render(containerRef.current, {
      sitekey: SITE_KEY,
      callback: (t: string) => onToken(t),
      "expired-callback": () => onToken(null),
      "error-callback": () => onToken(null),
      theme,
    });
    return true;
  }, [onToken, theme]);

  useEffect(() => {
    if (!SITE_KEY) return;
    // The script loads async; poll briefly until the global is ready.
    let tries = 0;
    const id = setInterval(() => {
      if (tryRender() || ++tries > 50) clearInterval(id);
    }, 100);
    return () => {
      clearInterval(id);
      const ts = (window as unknown as { turnstile?: TurnstileWidget }).turnstile;
      if (widgetId.current && ts) {
        try { ts.remove(widgetId.current); } catch { /* already gone */ }
        widgetId.current = null;
      }
    };
  }, [tryRender]);

  if (!SITE_KEY) return null;
  return <div ref={containerRef} className={className} />;
}
