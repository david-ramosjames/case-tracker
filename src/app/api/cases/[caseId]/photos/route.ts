import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { getCasePhotoAccess } from "@/lib/evidence-photos/access";
import { listEvidencePhotosForCase } from "@/lib/evidence-photos/repository";
import { countEvidencePhotos } from "@/lib/evidence-photos/types";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const sessionUser = await requireApiSession();
  if (!sessionUser) return unauthorizedResponse();

  const { caseId } = await params;
  const access = await getCasePhotoAccess(sessionUser, caseId);
  if (!access) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  try {
    const photos = await listEvidencePhotosForCase(access.caseNumber);
    return NextResponse.json({
      photos,
      counts: countEvidencePhotos(photos),
      canEdit: access.canEdit,
    });
  } catch (error) {
    console.error("Case photos load failed", { caseId, error });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load photos." }, { status: 500 });
  }
}
