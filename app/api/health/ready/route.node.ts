import { checkReadiness } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await checkReadiness();
  return Response.json(readiness, {
    status: readiness.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
