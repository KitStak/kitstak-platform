/** `GET /api/printers/agent` — downloads the Direct Print agent (`kitstak-print-agent.mjs`), bound to this server's origin. */
import { defineRoute } from "@/server/api/define-route";
import { PRINT_AGENT_FILENAME, printAgentSource } from "@/server/print-agent";

export const GET = defineRoute({
  handler: ({ request }) => {
    const origin = new URL(request.url).origin;
    return new Response(printAgentSource(origin), {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Content-Disposition": `attachment; filename="${PRINT_AGENT_FILENAME}"`,
        "Cache-Control": "no-store",
      },
    });
  },
});
