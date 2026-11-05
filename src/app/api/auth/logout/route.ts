import { NextResponse } from "next/server";
import { destroySession } from "@/server/auth/session";

export async function POST(): Promise<NextResponse> {
  try {
    await destroySession();
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    console.error("[kitstak:auth] logout failed", error);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
