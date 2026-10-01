import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import {
  DROPBOX_THUMBNAIL_SIZES,
  fetchDropboxThumbnail,
  isDropboxConfigured,
  type DropboxThumbnailSize,
} from "@/lib/dropbox/client";
import { getCasePhotoAccess } from "@/lib/evidence-photos/access";
import { getEvidencePhotoById } from "@/lib/evidence-photos/repository";

export const dynamic = "force-dynamic";

/** Proxies a Dropbox-generated thumbnail; nothing is stored. Browser caches it privately. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ caseId: string; photoId: string }> },
) {
  const sessionUser = await requireApiSession();
  if (!sessionUser) return unauthorizedResponse();
  if (!isDropboxConfigured()) {
    return NextResponse.json({ error: "Dropbox thumbnails are not configured." }, { status: 503 });
  }

  const { caseId, photoId } = await params;
  const access = await getCasePhotoAccess(sessionUser, caseId);
  if (!access) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const found = await getEvidencePhotoById(photoId);
  if (!found || found.photo.caseNumber !== access.caseNumber) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const requested = new URL(request.url).searchParams.get("size");
  const size: DropboxThumbnailSize = (DROPBOX_THUMBNAIL_SIZES as readonly string[]).includes(requested ?? "")
    ? (requested as DropboxThumbnailSize)
    : "w256h256";

  try {
    const upstream = await fetchDropboxThumbnail(
      { dropboxFileId: found.dropboxFileId, dropboxPath: found.photo.dropboxPath },
      size,
    );
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Dropbox thumbnail proxy failed", { photoId, error });
    return NextResponse.json({ error: "Thumbnail unavailable." }, { status: 502 });
  }
}
