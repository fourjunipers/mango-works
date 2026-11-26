import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

// zod without its JIT: no `new Function` probe in the browser, so a CSP
// without 'unsafe-eval' reports nothing (docs/platform/csp-decision.md §2, §5 item 3).
// This file runs before the app's own code, so it is set before any schema
// is used.
z.config({ jitless: true });

// Sentry in the browser. Off when NEXT_PUBLIC_SENTRY_DSN is unset.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    tracesSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
