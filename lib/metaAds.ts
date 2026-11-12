/**
 * Read-only Meta Ads insights for /admin/overview (Marketing API, a System User token with ads_read).
 * Env (server-only): META_ADS_TOKEN, META_AD_ACCOUNT_ID (digits, without "act_"), optional META_GRAPH_VERSION.
 * Missing env → { connected: false } and the page shows how to connect; any API error → { error }.
 */

export interface MetaDay {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  landingViews: number;
  valuations: number; // pixel ViewContent = saw a valuation
}
export interface MetaPlacement extends Omit<MetaDay, "date"> {
  platform: string;
  position: string;
}
export type MetaResult =
  | { connected: false }
  | { connected: true; error: string }
  | { connected: true; error: null; days: MetaDay[]; placements: MetaPlacement[] };

type Action = { action_type: string; value: string };
type Row = {
  date_start?: string;
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  actions?: Action[];
  publisher_platform?: string;
  platform_position?: string;
};

const action = (row: Row, ...types: string[]) => {
  for (const t of types) {
    const a = row.actions?.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
};
const metrics = (r: Row) => ({
  spend: Number(r.spend) || 0,
  impressions: Number(r.impressions) || 0,
  clicks: Number(r.inline_link_clicks) || 0,
  landingViews: action(r, "landing_page_view"),
  valuations: action(r, "offsite_conversion.fb_pixel_view_content", "view_content"),
});

async function insights(params: Record<string, string>): Promise<Row[]> {
  const v = process.env.META_GRAPH_VERSION || "v23.0";
  const url = new URL(`https://graph.facebook.com/${v}/act_${process.env.META_AD_ACCOUNT_ID}/insights`);
  for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);
  url.searchParams.set("limit", "500");
  // token in a header, not the URL, so it never lands in logs
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.META_ADS_TOKEN}` }, next: { revalidate: 600 } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return (body.data ?? []) as Row[];
}

export async function getMetaInsights(since: string, until: string): Promise<MetaResult> {
  if (!process.env.META_ADS_TOKEN || !process.env.META_AD_ACCOUNT_ID) return { connected: false };
  const base = {
    level: "account",
    fields: "spend,impressions,inline_link_clicks,actions",
    time_range: JSON.stringify({ since, until }),
  };
  try {
    const [daily, byPlacement] = await Promise.all([
      insights({ ...base, time_increment: "1" }),
      insights({ ...base, breakdowns: "publisher_platform,platform_position" }),
    ]);
    return {
      connected: true,
      error: null,
      days: daily.map((r) => ({ date: r.date_start ?? "", ...metrics(r) })).sort((a, b) => (a.date < b.date ? -1 : 1)),
      placements: byPlacement
        .map((r) => ({ platform: r.publisher_platform ?? "", position: r.platform_position ?? "", ...metrics(r) }))
        .sort((a, b) => b.spend - a.spend),
    };
  } catch (e) {
    return { connected: true, error: e instanceof Error ? e.message : String(e) };
  }
}
