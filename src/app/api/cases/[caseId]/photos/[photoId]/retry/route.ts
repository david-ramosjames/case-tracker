import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { getCasePhotoAccess } from "@/lib/evidence-photos/access";
import { getEvidencePhotoById, retryEvidencePhotoAnalysis } from "@/lib/evidence-photos/repository";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ caseId: string; photoId: string }> },
) {
  const sessionUser = await requireApiSession();
  if (!sessionUser) return unauthorizedResponse();

  const { caseId, photoId } = await params;
  const access = await getCasePhotoAccess(sessionUser, caseId);
  if (!access) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!access.canEdit) {
    return NextResponse.json({ error: "Only the assigned case team can retry analysis." }, { status: 403 });
  }

  const found = await getEvidencePhotoById(photoId);
  if (!found || found.photo.caseNumber !== access.caseNumber) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const photo = await retryEvidencePhotoAnalysis(photoId);
    return NextResponse.json({ photo });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Retry failed." }, { status: 400 });
  }
}
