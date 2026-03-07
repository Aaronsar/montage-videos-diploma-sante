import { NextRequest, NextResponse } from "next/server";

const RAILWAY =
  process.env.RAILWAY_URL ||
  "https://montage-videos-diploma-sante-production.up.railway.app";

async function handler(req: NextRequest) {
  const url = new URL(req.url);
  // Strip /api/proxy prefix + trailing slash (avoids FastAPI redirect loops)
  const path = url.pathname.replace("/api/proxy", "").replace(/\/$/, "") || "/";
  const targetUrl = RAILWAY + path + url.search;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!["host", "connection", "transfer-encoding"].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  // Buffer body (works for JSON; large uploads handled separately)
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: body,
  });

  const responseHeaders = new Headers();
  response.headers.forEach((value, key) => {
    if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  return new NextResponse(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const PATCH = handler;
