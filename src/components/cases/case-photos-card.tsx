"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageIcon,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  EVIDENCE_PHOTO_CATEGORIES,
  countEvidencePhotos,
  getEvidencePhotoDropboxUrl,
  getEvidencePhotoThumbnailUrl,
  isHiddenNonEvidence,
  type EvidencePhoto,
  type EvidencePhotoCounts,
} from "@/lib/evidence-photos/types";
import { formatDate } from "@/lib/utils";

type PhotosResponse = {
  photos: EvidencePhoto[];
  canEdit: boolean;
};

/** The file-sorter authenticates thumbnails with the viewer's Supabase access token (kept current on refresh). */
function useSupabaseAccessToken(enabled: boolean) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    void import("@/lib/supabase/browser").then(async ({ createSupabaseBrowserClient }) => {
      if (!active) return;
      const supabase = createSupabaseBrowserClient();
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        setToken(session?.access_token ?? null);
      });
      unsubscribe = () => data.subscription.unsubscribe();
      const { data: sessionData } = await supabase.auth.getSession();
      if (active) setToken(sessionData.session?.access_token ?? null);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [enabled]);
  return token;
}

const POLL_INTERVAL_MS = 20_000;

function statusSummary(counts: EvidencePhotoCounts) {
  const parts = [`${counts.ready} ready`];
  if (counts.analyzing) parts.push(`${counts.analyzing} analyzing`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  return `${counts.total} · ${parts.join(" · ")}`;
}

function photoTitle(photo: EvidencePhoto) {
  if (photo.title) return photo.title;
  if (photo.status === "failed") return "Analysis failed";
  return "Analyzing…";
}

export function CasePhotosCard({ caseId }: { caseId: string }) {
  const [data, setData] = useState<PhotosResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const accessToken = useSupabaseAccessToken(isExpanded);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/cases/${caseId}/photos`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Could not load photos.");
      setData(json as PhotosResponse);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load photos.");
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const analyzing = data ? countEvidencePhotos(data.photos).analyzing : 0;
  useEffect(() => {
    if (!isExpanded || analyzing === 0) return;
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isExpanded, analyzing, load]);

  const replacePhoto = useCallback((updated: EvidencePhoto) => {
    setData((current) => {
      if (!current) return current;
      return { ...current, photos: current.photos.map((photo) => (photo.id === updated.id ? updated : photo)) };
    });
  }, []);

  const allPhotos = useMemo(() => data?.photos ?? [], [data]);
  const visiblePhotos = useMemo(() => allPhotos.filter((photo) => !isHiddenNonEvidence(photo)), [allPhotos]);
  const hiddenCount = allPhotos.length - visiblePhotos.length;
  const photos = showHidden ? allPhotos : visiblePhotos;
  const counts = data ? countEvidencePhotos(visiblePhotos) : null;
  const viewerPhoto = viewerIndex !== null ? photos[viewerIndex] ?? null : null;

  function toggleHidden() {
    setViewerIndex(null);
    setShowHidden((current) => !current);
    setIsExpanded(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-0.5 h-8 w-8 shrink-0 p-0"
            onClick={() => setIsExpanded((current) => !current)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse case photos" : "Expand case photos"}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
          <div className="min-w-0">
            <CardTitle>
              Photos
              {counts && counts.total > 0 ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">{statusSummary(counts)}</span>
              ) : null}
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={toggleHidden}
                  aria-pressed={showHidden}
                  className="ml-2 text-sm font-normal text-pink-600 underline-offset-2 hover:underline"
                >
                  {showHidden ? `Hide ${hiddenCount} non-evidence` : `Show ${hiddenCount} hidden`}
                </button>
              ) : null}
            </CardTitle>
            <CardDescription>
              Case photos from Dropbox with AI-written descriptions of what is visible. Descriptions are not legal or
              medical conclusions.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      {isExpanded ? (
        <CardContent>
          {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
          {!data && !loadError ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading photos…
            </p>
          ) : null}
          {data && allPhotos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No photos imported yet. Photos added to this case&apos;s Dropbox folder appear here automatically.
            </p>
          ) : null}
          {data && allPhotos.length > 0 && photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All {hiddenCount} photos were flagged as non-evidence (logos, signatures, notifications).
            </p>
          ) : null}
          {photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {photos.map((photo, index) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setViewerIndex(index)}
                  className={`group flex min-w-0 flex-col overflow-hidden rounded-md border bg-white text-left transition hover:border-pink-400 hover:shadow-sm ${
                    isHiddenNonEvidence(photo) ? "opacity-50 hover:opacity-80" : ""
                  }`}
                >
                  <PhotoImage
                    photo={photo}
                    size="w480h320"
                    accessToken={accessToken}
                    className="aspect-[3/2] w-full object-cover"
                  />
                  <div className="min-w-0 space-y-0.5 p-2">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">{photoTitle(photo)}</p>
                    <p className="truncate text-xs text-muted-foreground" title={photo.originalFilename}>
                      {photo.originalFilename}
                    </p>
                    {photo.status !== "complete" ? <PhotoStatusBadge photo={photo} /> : null}
                    <HiddenReasonLabel photo={photo} />
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      ) : null}

      {viewerPhoto && data ? (
        <PhotoViewer
          caseId={caseId}
          photo={viewerPhoto}
          canEdit={data.canEdit}
          accessToken={accessToken}
          position={`${(viewerIndex ?? 0) + 1} / ${photos.length}`}
          onClose={() => setViewerIndex(null)}
          onPrevious={
            viewerIndex !== null && viewerIndex > 0 ? () => setViewerIndex(viewerIndex - 1) : undefined
          }
          onNext={
            viewerIndex !== null && viewerIndex < photos.length - 1
              ? () => setViewerIndex(viewerIndex + 1)
              : undefined
          }
          onUpdated={replacePhoto}
        />
      ) : null}
    </Card>
  );
}

function HiddenReasonLabel({ photo }: { photo: EvidencePhoto }) {
  if (!isHiddenNonEvidence(photo)) return null;
  return (
    <p className="text-[11px] font-medium text-muted-foreground">
      Hidden: {photo.evidenceReason ?? "not evidence"}
    </p>
  );
}

function PhotoStatusBadge({ photo }: { photo: EvidencePhoto }) {
  if (photo.status === "failed") return <Badge variant="danger">Failed</Badge>;
  if (photo.status === "processing") return <Badge variant="warning">Analyzing</Badge>;
  if (photo.status === "pending") return <Badge variant="outline">Queued</Badge>;
  return null;
}

function PhotoImage({
  photo,
  size,
  accessToken,
  className,
}: {
  photo: EvidencePhoto;
  size: "w480h320" | "w1024h768";
  accessToken: string | null;
  className?: string;
}) {
  const [failedToken, setFailedToken] = useState<string | null>(null);
  if (!accessToken || failedToken === accessToken) {
    return (
      <div className={`flex items-center justify-center bg-muted text-muted-foreground ${className ?? ""}`}>
        <ImageIcon className="h-8 w-8" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- file-sorter streams from Dropbox; next/image would cache copies
    <img
      src={getEvidencePhotoThumbnailUrl(photo.id, size, accessToken)}
      alt={photo.title ?? photo.originalFilename}
      loading="lazy"
      className={className}
      onError={() => setFailedToken(accessToken)}
    />
  );
}

function PhotoViewer({
  caseId,
  photo,
  canEdit,
  accessToken,
  position,
  onClose,
  onPrevious,
  onNext,
  onUpdated,
}: {
  caseId: string;
  photo: EvidencePhoto;
  canEdit: boolean;
  accessToken: string | null;
  position: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onUpdated: (photo: EvidencePhoto) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(photo.title ?? "");
  const [description, setDescription] = useState(photo.description ?? "");
  const [category, setCategory] = useState<string>(photo.category ?? "");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsEditing(false);
    setTitle(photo.title ?? "");
    setDescription(photo.description ?? "");
    setCategory(photo.category ?? "");
    setError(null);
  }, [photo.id, photo.title, photo.description, photo.category]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (isEditing) return;
      if (event.key === "ArrowLeft") onPrevious?.();
      if (event.key === "ArrowRight") onNext?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isEditing, onClose, onPrevious, onNext]);

  async function save() {
    setIsBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/photos/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, category: category || null }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Could not save.");
      onUpdated(json.photo as EvidencePhoto);
      setIsEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save.");
    } finally {
      setIsBusy(false);
    }
  }

  async function retry() {
    setIsBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/photos/${photo.id}/retry`, { method: "POST" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Retry failed.");
      onUpdated(json.photo as EvidencePhoto);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Retry failed.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={photoTitle(photo)}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl lg:flex-row"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative flex min-h-[240px] flex-1 items-center justify-center bg-neutral-900">
          <a
            href={getEvidencePhotoDropboxUrl(photo)}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center"
            title="Open original in Dropbox"
          >
            <PhotoImage
              key={photo.id}
              photo={photo}
              size="w1024h768"
              accessToken={accessToken}
              className="max-h-[60vh] w-full object-contain lg:max-h-[92vh]"
            />
          </a>
          {onPrevious ? (
            <button
              type="button"
              onClick={onPrevious}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              aria-label="Previous photo"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
          {onNext ? (
            <button
              type="button"
              onClick={onNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              aria-label="Next photo"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : null}
          <span className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">{position}</span>
        </div>

        <div className="flex w-full flex-col gap-4 overflow-y-auto p-5 lg:w-[380px]">
          <div className="flex items-start justify-between gap-3">
            {isEditing ? (
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} aria-label="Title" />
            ) : (
              <h3 className="text-lg font-semibold leading-snug">{photoTitle(photo)}</h3>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isEditing ? (
              <Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
                <option value="">No category</option>
                {EVIDENCE_PHOTO_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : photo.category ? (
              <Badge variant="pink">{photo.category}</Badge>
            ) : null}
            {!isEditing ? <PhotoStatusBadge photo={photo} /> : null}
            {isHiddenNonEvidence(photo) ? (
              <Badge variant="outline">Hidden: {photo.evidenceReason ?? "not evidence"}</Badge>
            ) : null}
          </div>

          {isEditing ? (
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={8}
              maxLength={4000}
              aria-label="Description"
            />
          ) : photo.description ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{photo.description}</p>
          ) : photo.status === "failed" ? (
            <p className="text-sm text-destructive">{photo.error ?? "The AI could not analyze this photo."}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Description will appear once analysis finishes.</p>
          )}

          <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
            <p className="break-all">
              <span className="font-medium text-foreground">File:</span> {photo.originalFilename}
            </p>
            {photo.takenAt ? <p>Dropbox date: {formatDate(photo.takenAt)}</p> : null}
            <p>
              {photo.humanEdited && photo.editedBy
                ? `Edited by ${photo.editedBy}${photo.editedAt ? ` on ${formatDate(photo.editedAt)}` : ""}`
                : "AI-generated description — verify against the photo."}
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="mt-auto flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={getEvidencePhotoDropboxUrl(photo)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open in Dropbox
              </a>
            </Button>
            {canEdit && photo.status === "failed" ? (
              <Button variant="outline" size="sm" onClick={retry} disabled={isBusy}>
                <RefreshCw className={`h-4 w-4 ${isBusy ? "animate-spin" : ""}`} />
                Retry analysis
              </Button>
            ) : null}
            {canEdit && !isEditing ? (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            ) : null}
            {isEditing ? (
              <>
                <Button variant="pink" size="sm" onClick={save} disabled={isBusy || !title.trim()}>
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)} disabled={isBusy}>
                  Cancel
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
