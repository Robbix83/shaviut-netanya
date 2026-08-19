import { describe, it, expect, afterEach } from "vitest";
import { POST } from "@/app/api/dev/save-streets/route";

const savedEnv = process.env.NODE_ENV;
afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = savedEnv;
});

function makeReq(body: unknown) {
  return {
    json: async () => body,
    headers: new Headers({ "content-type": "application/json" }),
    nextUrl: new URL("http://localhost/api/dev/save-streets"),
  } as any;
}

describe("POST /api/dev/save-streets — dev-only mutation guard", () => {
  it("is disabled (403) in production, without touching the filesystem", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const res = await POST(makeReq({ mapped: [{ street: "x", neighborhoodId: "1", neighborhoodName: "n" }] }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("disabled_in_production");
  });
});
