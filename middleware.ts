import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Refresh the session cookie so it doesn't expire mid-session
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  try {
    const timeout = new Promise<never>((_, r) => setTimeout(() => r(new Error('auth-timeout')), 2000));
    await Promise.race([supabase.auth.getUser(), timeout]);
  } catch (_) { /* Supabase unreachable or slow — skip session refresh */ }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|ffmpeg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
