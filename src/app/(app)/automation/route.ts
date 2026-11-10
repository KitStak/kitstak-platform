import { NextResponse, type NextRequest } from "next/server";

/** Section index: the bare URL (breadcrumb parent / typed URL) redirects to its first sub-page instead of a 404. */
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/automation/algorithms", req.url), 307);
}
