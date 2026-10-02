import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { getCasePhotoAccess } from "@/lib/evidence-photos/access";
import { getEvidencePhotoById, updateEvidencePhotoDetails } from "@/lib/evidence-photos/repository";
import { isEvidencePhotoCategory } from "@/lib/evidence-photos/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ caseId: string; photoId: string }> },
) {
  const sessionUser = await requireApiSession();
  if (!sessionUser) return unauthorizedResponse();

  const { caseId, photoId } = await params;
  const access = await getCasePhotoAccess(sessionUser, caseId);
  if (!access) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!access.canEdit) {
    return NextResponse.json({ error: "Only the assigned case team can edit photo details." }, { status: 403 });
  }

  const found = await getEvidencePhotoById(photoId);
  if (!found || found.caseNumber !== access.caseNumber) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    description?: unknown;
    category?: unknown;
  } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: "Title must be 200 characters or fewer." }, { status: 400 });
  if (description.length > 4000) {
    return NextResponse.json({ error: "Description must be 4000 characters or fewer." }, { status: 400 });
  }
  if (body?.category != null && body.category !== "" && !isEvidencePhotoCategory(body.category)) {
    return NextResponse.json({ error: "Unknown category." }, { status: 400 });
  }
  const category = isEvidencePhotoCategory(body?.category) ? body.category : null;

  try {
    const photo = await updateEvidencePhotoDetails(photoId, { title, description, category }, sessionUser.name);
    return NextResponse.json({ photo });
  } catch (error) {
    console.error("Photo edit failed", { photoId, error });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save photo." }, { status: 500 });
  }
}
