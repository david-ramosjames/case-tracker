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
  originalFilename: string;
  title: string | null;
  description: string | null;
  category: EvidencePhotoCategory | null;
  status: EvidencePhotoStatus;
  error: string | null;
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

/** Dropbox web preview of the original file (works for any team member with folder access). */
export function getDropboxPreviewUrl(dropboxPath: string) {
  const slash = dropboxPath.lastIndexOf("/");
  const folder = slash > 0 ? dropboxPath.slice(0, slash) : "";
  const filename = dropboxPath.slice(slash + 1);
  const encodedFolder = folder
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://www.dropbox.com/home${encodedFolder}?preview=${encodeURIComponent(filename)}`;
}
