import type { TraceResponse } from "./types.js";

export async function callService<TPayload = TraceResponse>(
  url: string,
  method: "GET" | "POST",
  token: string,
  traceId: string,
  body?: unknown
): Promise<{ status: number; payload: TPayload }> {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-trace-id": traceId
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });

  return {
    status: response.status,
    payload: (await response.json()) as TPayload
  };
}
