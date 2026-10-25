import {
  accessTokenFromRequest,
  authenticateStudioAccessToken,
  createGateCookie,
  expiredGateCookies,
  isSameOriginMutation,
} from "../server/studio-auth.mjs";

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
  Vary: "Cookie, Authorization, Origin",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request) {
  const access = await authenticateStudioAccessToken(accessTokenFromRequest(request));
  return Response.json(
    access.ok
      ? { authenticated: true, userId: access.user.id, workspaceId: access.membership.workspace_id }
      : { authenticated: false, reason: access.reason },
    { status: access.ok ? 200 : access.status, headers: responseHeaders },
  );
}

export async function POST(request) {
  if (!isSameOriginMutation(request)) return errorResponse(403, "origin-rejected");
  const accessToken = accessTokenFromRequest(request);
  const access = await authenticateStudioAccessToken(accessToken);
  if (!access.ok) return errorResponse(access.status, access.reason);
  const headers = new Headers(responseHeaders);
  headers.append("Set-Cookie", createGateCookie(request, accessToken));
  return Response.json(
    { authenticated: true, userId: access.user.id, workspaceId: access.membership.workspace_id },
    { status: 200, headers },
  );
}

export async function DELETE(request) {
  if (!isSameOriginMutation(request)) return errorResponse(403, "origin-rejected");
  const headers = new Headers(responseHeaders);
  for (const cookie of expiredGateCookies()) headers.append("Set-Cookie", cookie);
  return Response.json({ authenticated: false }, { status: 200, headers });
}

function errorResponse(status, reason) {
  return Response.json({ authenticated: false, reason }, { status, headers: responseHeaders });
}
