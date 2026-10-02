export const EVIDENCE_PHOTO_CATEGORIES = [
  "Vehicle Damage",
  "Injury",
  "Accident Scene",
  "Property Damage",
  "Medical",
  "Document",
  "Other",
] as const;

export type EvidencePhotoCategory = (typeof EVIDENCE_PHOTO_CATEGORIES)[number];

export type EvidencePhotoStatus = "pending" | "processing" | "complete" | "failed";

export type EvidencePhoto = {
  id: string;
  caseNumber: string;
  dropboxPath: string;
  dropboxPermalink: string | null;
  originalFilename: string;
  title: string | null;
  description: string | null;
  category: EvidencePhotoCategory | null;
  status: EvidencePhotoStatus;
  error: string | null;
  /** Set by the file-sorter (read-only here). false = non-evidence (logo, signature, notification…); null = not yet checked. */
  isEvidence: boolean | null;
  evidenceReason: string | null;
  humanEdited: boolean;
  editedBy: string | null;
  editedAt: string | null;
  takenAt: string | null;
  createdAt: string;
};

export type EvidencePhotoCounts = {
  total: number;
  ready: number;
  analyzing: number;
  failed: number;
};

export function isEvidencePhotoCategory(value: unknown): value is EvidencePhotoCategory {
  return typeof value === "string" && (EVIDENCE_PHOTO_CATEGORIES as readonly string[]).includes(value);
}

export function countEvidencePhotos(photos: EvidencePhoto[]): EvidencePhotoCounts {
  return {
    total: photos.length,
    ready: photos.filter((photo) => photo.status === "complete").length,
    analyzing: photos.filter((photo) => photo.status === "pending" || photo.status === "processing").length,
    failed: photos.filter((photo) => photo.status === "failed").length,
  };
}

/** Unchecked photos (null) stay visible; only photos the sorter flagged as non-evidence are hidden. */
export function isHiddenNonEvidence(photo: EvidencePhoto) {
  return photo.isEvidence === false;
}

/** Team shared link from the sorter; falls back to a path-based URL (only works if the viewer's Dropbox mirrors the team folder). */
export function getEvidencePhotoDropboxUrl(photo: EvidencePhoto) {
  if (photo.dropboxPermalink) return photo.dropboxPermalink;
  const slash = photo.dropboxPath.lastIndexOf("/");
  const folder = slash > 0 ? photo.dropboxPath.slice(0, slash) : "";
  const filename = photo.dropboxPath.slice(slash + 1);
  const encodedFolder = folder
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://www.dropbox.com/home${encodedFolder}?preview=${encodeURIComponent(filename)}`;
}

const DEFAULT_FILE_SORTER_URL = "https://email-attachment-sorter-production.up.railway.app";

/** Thumbnail served by the file-sorter (streams from Dropbox; authenticated with the viewer's Supabase token). */
export function getEvidencePhotoThumbnailUrl(
  photoId: string,
  size: "w256h256" | "w480h320" | "w640h480" | "w1024h768",
  accessToken: string,
) {
  const base = (process.env.NEXT_PUBLIC_FILE_SORTER_URL?.trim() || DEFAULT_FILE_SORTER_URL).replace(/\/$/, "");
  return `${base}/evidence-photos/${photoId}/thumbnail?size=${size}&access_token=${encodeURIComponent(accessToken)}`;
}
