// Says where the function runs. No secrets, no database.
import type { Context } from "@netlify/functions";

export default async (_req: Request, context: Context) =>
  Response.json({
    region: context.server?.region ?? null,
    awsRegion: process.env.AWS_REGION ?? null,
    node: process.version,
    deploy: context.deploy?.id?.slice(-6) ?? null,
    published: context.deploy?.published ?? null,
  });

export const config = { path: "/api/whoami" };
