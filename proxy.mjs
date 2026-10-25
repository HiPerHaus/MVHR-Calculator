import { next } from "@vercel/functions";
import { authorizeStudioRequest, loginRedirect } from "./server/studio-auth.mjs";

export default async function proxy(request) {
  const access = await authorizeStudioRequest(request);
  if (!access.ok) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: loginRedirect(request, access.reason).toString(),
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  }
  return next();
}
