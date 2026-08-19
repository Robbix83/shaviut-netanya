/**
 * In-memory rate limiter — מספיק לפרויקט יחיד / Vercel serverless (per-instance)
 * לפרודקשן רציני: החלף ב-Upstash Redis.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const _buckets = new Map<string, Bucket>();

/**
 * בדוק האם הבקשה מותרת.
 * @param key     מפתח ייחודי (IP + endpoint)
 * @param limit   מקסימום בקשות בחלון
 * @param windowMs חלון זמן במילישניות
 */
export function rateCheck(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let bucket = _buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 1, resetAt: now + windowMs };
    _buckets.set(key, bucket);
    // ניקוי entries ישנים (מניעת דליפת זיכרון)
    if (_buckets.size > 10_000) {
      for (const [k, v] of _buckets) {
        if (now > v.resetAt) _buckets.delete(k);
      }
    }
    return true;
  }

  bucket.count++;
  if (bucket.count > limit) return false;
  return true;
}

/** חלץ IP מ-NextRequest */
export function getIP(req: Request): string {
  const forwarded = (req.headers as any).get?.("x-forwarded-for") || "";
  return (forwarded.split(",")[0] || "unknown").trim();
}
