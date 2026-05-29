import { NextRequest, NextResponse } from "next/server";
import { analyzeMealImage } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { image?: string; mimeType?: string };
    const { image, mimeType } = body;

    if (!image || !mimeType) {
      return NextResponse.json(
        { error: "Missing image data." },
        { status: 400 },
      );
    }

    // Strip a data-URL prefix if present.
    const base64 = image.includes(",") ? image.split(",")[1] : image;

    if (Buffer.byteLength(base64, "base64") > MAX_BYTES) {
      return NextResponse.json(
        { error: "Image is too large. Please use an image under 8 MB." },
        { status: 413 },
      );
    }

    const result = await analyzeMealImage(base64, mimeType);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to analyze the image.";
    const isConfig = message.includes("GEMINI_API_KEY");
    return NextResponse.json(
      {
        error: isConfig
          ? "The AI service is not configured. Set GEMINI_API_KEY."
          : "We couldn't analyze that photo. Please try again with a clearer image.",
      },
      { status: isConfig ? 500 : 502 },
    );
  }
}
