# 02 — BUILD / MIDDLEWARE FIX (Wave 0A-1)

**Date:** 2026-08-20

## BEFORE_ERROR (reproduced)
```
middleware.ts(11,11): error TS2352: Conversion of type '(...next-auth auth overload intersection...)'
to type '(req: NextRequest) => Promise<NextResponse<unknown>>' may be a mistake because neither type
sufficiently overlaps with the other. Target signature provides too few arguments. Expected 2 or more, but got 1.
```
`next build`: JS compiled, then **Failed to type check** at the same error → exit 1.

## ROOT_CAUSE
`middleware.ts:11` cast the next-auth `auth` export to a hand-written single-arg signature `(req: NextRequest) => Promise<NextResponse>`. In next-auth 5.0.0-beta.31, `auth` is an intersection of several overloads (RSC/route-handler/middleware/getServerSideProps). None matches that single-arg shape, so the `as` cast is rejected by TS2352.

## EXACT_FIX
Replaced the cast with the installed library's prescribed middleware-wrapper form:
```ts
export default auth((req) => {
  if (process.env.ADMIN_DEV_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }
  if (!req.auth) {
    return NextResponse.redirect(new URL("/admin/login", req.nextUrl.origin));
  }
  return NextResponse.next();
});
export const config = { matcher: ["/admin/((?!login).*)"] };
```
No `as any`, no `@ts-ignore`, no `@ts-expect-error`, no strictness change, no dependency/framework upgrade.

## WHY THIS MATCHES INSTALLED TYPES
- `node_modules/next-auth/index.d.ts:122-129` documents exactly `export default auth((req) => { … req.auth … })`.
- The `auth` overload `((...args: [NextAuthMiddleware]) => NextMiddleware)` (`index.d.ts:209-211`) accepts a middleware function and returns a `NextMiddleware`. Our arrow `(req) => …` matches `NextAuthMiddleware` (`req: NextAuthRequest` carries `.auth`), so no cast is needed.
- Runtime semantics verified in `node_modules/next-auth/lib/index.js:126-155` (`handleAuth`): when a user function is passed, next-auth **always** invokes it with `req.auth` populated and lets it return the response. The `authorized` callback's boolean is only consulted in the no-user-function branch. Therefore the middleware function is fully responsible for allow/redirect — our explicit `if (!req.auth) redirect` reproduces the intended protection, and the dev-bypass branch runs before it.

## AUTH_BEHAVIOR_PRESERVED
- `/admin/*` (except `/admin/login`, per `matcher`) still requires an authenticated session; unauthenticated → redirect to `/admin/login`.
- `ADMIN_DEV_BYPASS` retained but **guarded by `NODE_ENV !== "production"`** → cannot fail-open in production.
- `auth.ts` `signIn` now delegates to `isAdminAuthorized` (`lib/adminAuth.ts`): with `ADMIN_EMAIL` set → only that email; unset → **denied in production**, allowed only in development. This is a fail-closed hardening of the previous behavior (which allowed any Google account when `ADMIN_EMAIL` was unset).

## TEST_RESULTS
`npm test` → 24 passed (adminAuth 4, otp 14, lead-gate 6). Admin authorization decision covered by `lib/__tests__/adminAuth.test.ts` (exact-match, prod fail-closed, dev-permissive). Direct next-auth middleware integration was intentionally not mocked (excessive framework mocking); the security-relevant decision is unit-tested at the `isAdminAuthorized` seam per the wave's guidance.

## BUILD_RESULT
`npx tsc --noEmit` → clean. `npx next build` → **exit 0**, "✓ Compiled successfully", 26 static pages generated, middleware compiled (shown as "ƒ Proxy (Middleware)"). The pre-existing non-fatal "middleware convention deprecated → use proxy" warning remains and was intentionally not addressed in this wave.
