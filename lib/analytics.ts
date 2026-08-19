type Win = typeof window & { gtag?: (...a: unknown[]) => void; fbq?: (...a: unknown[]) => void };

const FB_STANDARD: Record<string, string> = {
  lead_submitted: "Lead",
  valuation_viewed: "ViewContent",
};

export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const w = window as Win;
  if (w.gtag) w.gtag("event", name, params ?? {});
  if (w.fbq) {
    const std = FB_STANDARD[name];
    if (std) w.fbq("track", std, params);
    else w.fbq("trackCustom", name, params);
  }
}
