import { NextRequest } from "next/server";
import { subscribeTerminal } from "@/lib/terminal-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = subscribeTerminal(id, (event) => {
        try { controller.enqueue(encoder.encode(sse(event))); } catch { /* stream closed */ }
      });
      if (!unsubscribe) {
        controller.enqueue(encoder.encode(sse({ type: "error", error: "Terminal not found" })));
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(": connected\n\n"));

      request.signal.addEventListener("abort", () => {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
