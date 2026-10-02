import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  isEvidencePhotoCategory,
  type EvidencePhoto,
  type EvidencePhotoCategory,
  type EvidencePhotoStatus,
} from "@/lib/evidence-photos/types";

const PHOTO_COLUMNS = [
  "id",
  "case_number",
  "dropbox_path",
  "dropbox_permalink",
  "original_filename",
  "ai_title",
  "ai_description",
  "category",
  "analysis_status",
  "analysis_error",
  "human_edited",
  "edited_by",
  "edited_at",
  "dropbox_client_modified",
  "created_at",
].join(",");

type EvidencePhotoRow = {
  id: string;
  case_number: string;
  dropbox_path: string;
  dropbox_permalink: string | null;
  original_filename: string;
  ai_title: string | null;
  ai_description: string | null;
  category: string | null;
  analysis_status: EvidencePhotoStatus;
  analysis_error: string | null;
  human_edited: boolean;
  edited_by: string | null;
  edited_at: string | null;
  dropbox_client_modified: string | null;
  created_at: string;
};

function rowToPhoto(row: EvidencePhotoRow): EvidencePhoto {
  return {
    id: row.id,
    caseNumber: row.case_number,
    dropboxPath: row.dropbox_path,
    dropboxPermalink: row.dropbox_permalink,
    originalFilename: row.original_filename,
    title: row.ai_title,
    description: row.ai_description,
    category: isEvidencePhotoCategory(row.category) ? row.category : null,
    status: row.analysis_status,
    error: row.analysis_error,
    humanEdited: row.human_edited,
    editedBy: row.edited_by,
    editedAt: row.edited_at,
    takenAt: row.dropbox_client_modified,
    createdAt: row.created_at,
  };
}

function requireAdmin() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Supabase admin client is not configured.");
  return admin;
}

export async function listEvidencePhotosForCase(caseNumber: string): Promise<EvidencePhoto[]> {
  const { data, error } = await requireAdmin()
    .from("evidence_photos")
    .select(PHOTO_COLUMNS)
    .eq("case_number", caseNumber)
    .is("deleted_at", null)
    .order("dropbox_client_modified", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as EvidencePhotoRow[]).map(rowToPhoto);
}

export async function getEvidencePhotoById(id: string): Promise<EvidencePhoto | null> {
  const { data, error } = await requireAdmin()
    .from("evidence_photos")
    .select(PHOTO_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToPhoto(data as unknown as EvidencePhotoRow) : null;
}

export async function updateEvidencePhotoDetails(
  id: string,
  input: { title: string; description: string; category: EvidencePhotoCategory | null },
  editedBy: string,
): Promise<EvidencePhoto> {
  const { data, error } = await requireAdmin()
    .from("evidence_photos")
    .update({
      ai_title: input.title,
      ai_description: input.description,
      category: input.category,
      human_edited: true,
      edited_by: editedBy,
      edited_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(PHOTO_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return rowToPhoto(data as unknown as EvidencePhotoRow);
}

/** Puts a failed photo back on the file-sorter analysis queue. */
export async function retryEvidencePhotoAnalysis(id: string): Promise<EvidencePhoto> {
  const { data, error } = await requireAdmin()
    .from("evidence_photos")
    .update({ analysis_status: "pending", analysis_error: null, processing_started_at: null })
    .eq("id", id)
    .eq("analysis_status", "failed")
    .select(PHOTO_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only failed photos can be retried.");
  return rowToPhoto(data as unknown as EvidencePhotoRow);
}
