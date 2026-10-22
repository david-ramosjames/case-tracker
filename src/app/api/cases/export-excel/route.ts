import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireApiSession, unauthorizedResponse } from "@/lib/auth/api";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { listEvidencePhotosForCase } from "@/lib/evidence-photos/repository";
import { getEvidencePhotoDropboxUrl } from "@/lib/evidence-photos/types";
import { type CaseRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PHOTOS_PER_CASE = 10;
const PHOTO_FETCH_TIMEOUT_MS = 3000;

const DEFAULT_FILE_SORTER_URL = "https://email-attachment-sorter-production.up.railway.app";

function sanitizeSheetName(name: string): string {
  // Excel sheet names: max 31 chars, no: \ / ? * [ ]
  let sanitized = name.replace(/[\\\/\?\*\[\]]/g, "_");
  if (sanitized.length > 31) {
    sanitized = sanitized.slice(0, 31);
  }
  return sanitized || "Case";
}

function makeUniqueSheetName(name: string, existing: Set<string>): string {
  const candidate = sanitizeSheetName(name);
  if (!existing.has(candidate)) {
    existing.add(candidate);
    return candidate;
  }
  
  // Try appending numbers until we find a unique name
  for (let i = 2; i <= 999; i++) {
    const suffix = ` ${i}`;
    const maxBase = 31 - suffix.length;
    const numbered = sanitizeSheetName(name).slice(0, maxBase) + suffix;
    if (!existing.has(numbered)) {
      existing.add(numbered);
      return numbered;
    }
  }
  
  // Fallback to timestamp
  const timestamp = Date.now().toString().slice(-6);
  existing.add(timestamp);
  return timestamp;
}

async function fetchPhotoThumbnail(
  photoId: string,
  accessToken: string,
): Promise<Buffer | null> {
  try {
    const base = (process.env.NEXT_PUBLIC_FILE_SORTER_URL?.trim() || DEFAULT_FILE_SORTER_URL).replace(/\/$/, "");
    const url = `${base}/evidence-photos/${photoId}/thumbnail?size=w256h256&access_token=${encodeURIComponent(accessToken)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PHOTO_FETCH_TIMEOUT_MS);
    
    const response = await fetch(url, {
      headers: { Accept: "image/*" },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`Failed to fetch photo ${photoId}: ${response.status}`);
      return null;
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer) as Buffer;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`Photo fetch timeout for ${photoId}`);
    } else {
      console.warn(`Error fetching photo ${photoId}:`, error);
    }
    return null;
  }
}

async function fetchPhotoBatch(
  photos: Array<{ id: string; title: string | null; description: string | null; originalFilename: string }>,
  accessToken: string,
): Promise<Array<{ photo: typeof photos[0]; buffer: Buffer | null }>> {
  const promises = photos.map(async (photo) => ({
    photo,
    buffer: await fetchPhotoThumbnail(photo.id, accessToken),
  }));
  
  return await Promise.all(promises);
}

function formatCurrency(value: number | null): string {
  if (value == null) return "";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return value;
  }
}

async function addCaseSheet(
  workbook: ExcelJS.Workbook,
  caseRecord: CaseRecord,
  sheetName: string,
  accessToken: string,
  users: Array<{ id: string; name: string }>,
) {
  const sheet = workbook.addWorksheet(sheetName);
  
  // Set column widths
  sheet.columns = [
    { width: 25 }, // A: Labels
    { width: 50 }, // B: Values
    { width: 46 }, // C: Evidence photos, stacked
  ];
  
  let currentRow = 1;
  
  // Header section
  const titleCell = sheet.getCell(`A${currentRow}`);
  titleCell.value = `${caseRecord.shared.caseNumber} - ${caseRecord.shared.clientName}`;
  titleCell.font = { bold: true, size: 16 };
  currentRow += 2;
  
  // Resolve user names
  const attorneyName = users.find((u) => u.id === caseRecord.shared.attorneyId)?.name || caseRecord.shared.attorneyId;
  const paralegalName = users.find((u) => u.id === caseRecord.shared.paralegalId)?.name || caseRecord.shared.paralegalId;
  const legalAssistantName = caseRecord.shared.legalAssistantId 
    ? users.find((u) => u.id === caseRecord.shared.legalAssistantId)?.name || caseRecord.shared.legalAssistantId
    : "";

  // Case details
  const details = [
    ["Case Number", caseRecord.shared.caseNumber],
    ["Client Name", caseRecord.shared.clientName],
    ["Attorney", attorneyName],
    ["Paralegal", paralegalName],
    ["Legal Assistant", legalAssistantName],
    ["Case Type", caseRecord.shared.caseType],
    ["Date Signed", formatDate(caseRecord.shared.dateSigned)],
    ["Date of Incident", formatDate(caseRecord.shared.dateOfIncident)],
    ["Status", caseRecord.shared.status],
    ["Stage", caseRecord.tracker.caseStage],
    ["Estimated Settlement Value", formatCurrency(caseRecord.tracker.estimatedSettlementValue)],
    ["Estimated Fee Value", formatCurrency(caseRecord.tracker.estimatedFeeValue)],
    ["Target Resolution Quarter", caseRecord.tracker.targetResolutionQuarter || ""],
    ["Confidence Level", caseRecord.tracker.confidenceLevel || ""],
    ["Policy Limits", formatCurrency(caseRecord.tracker.policyLimits)],
    ["Minimum Value", formatCurrency(caseRecord.tracker.minimumValue)],
    ["Expected Litigation", caseRecord.tracker.expectedLitigation || ""],
  ];
  
  details.forEach(([label, value]) => {
    const labelCell = sheet.getCell(`A${currentRow}`);
    const valueCell = sheet.getCell(`B${currentRow}`);
    labelCell.value = label;
    labelCell.font = { bold: true };
    valueCell.value = value || "";
    currentRow++;
  });
  
  // Case description
  if (caseRecord.tracker.caseDescription) {
    currentRow++;
    const descLabelCell = sheet.getCell(`A${currentRow}`);
    descLabelCell.value = "Case Description";
    descLabelCell.font = { bold: true };
    currentRow++;
    
    const descValueCell = sheet.getCell(`A${currentRow}`);
    descValueCell.value = caseRecord.tracker.caseDescription;
    descValueCell.alignment = { wrapText: true, vertical: "top" };
    sheet.mergeCells(`A${currentRow}:B${currentRow}`);
    sheet.getRow(currentRow).height = Math.min(150, Math.max(30, caseRecord.tracker.caseDescription.split("\n").length * 15));
    currentRow++;
  }
  
  // Injuries
  if (caseRecord.tracker.injuries) {
    currentRow++;
    const injLabelCell = sheet.getCell(`A${currentRow}`);
    injLabelCell.value = "Injuries";
    injLabelCell.font = { bold: true };
    currentRow++;
    
    const injValueCell = sheet.getCell(`A${currentRow}`);
    injValueCell.value = caseRecord.tracker.injuries;
    injValueCell.alignment = { wrapText: true, vertical: "top" };
    sheet.mergeCells(`A${currentRow}:B${currentRow}`);
    sheet.getRow(currentRow).height = Math.min(100, Math.max(30, caseRecord.tracker.injuries.split("\n").length * 15));
    currentRow++;
  }
  
  // Fetch and add photos (limit for performance)
  try {
    const photos = await listEvidencePhotosForCase(caseRecord.shared.caseNumber);
    const readyPhotos = photos
      .filter((photo) => photo.status === "complete" && photo.isEvidence !== false)
      .slice(0, MAX_PHOTOS_PER_CASE);
    
    if (readyPhotos.length > 0) {
      const photosHeaderCell = sheet.getCell("C1");
      photosHeaderCell.value = `Evidence Photos (${readyPhotos.length}${photos.length > MAX_PHOTOS_PER_CASE ? ` of ${photos.length}` : ""})`;
      photosHeaderCell.font = { bold: true, size: 12 };

      const photoData = readyPhotos.map((photo) => ({
        id: photo.id,
        title: photo.title,
        description: photo.description,
        originalFilename: photo.originalFilename,
      }));
      const fetchedPhotos = await fetchPhotoBatch(photoData, accessToken);

      // Default rows are ~20px. A 100px image fills five of them, so the
      // caption starts on the next row instead of several rows below.
      const imageRows = 5;
      let row = 3;

      for (let i = 0; i < readyPhotos.length; i++) {
        const photo = readyPhotos[i];
        const photoBuffer = fetchedPhotos[i]?.buffer;

        if (photoBuffer) {
          try {
            const imageId = workbook.addImage({
              buffer: photoBuffer as unknown as ArrayBuffer,
              extension: "jpeg",
            });
            sheet.addImage(imageId, {
              tl: { col: 2, row: row - 1 },
              ext: { width: 300, height: 100 },
              editAs: "oneCell",
            });
          } catch (error) {
            console.warn(`Failed to add image for photo ${photo.id}:`, error);
          }
        }

        const titleRow = photoBuffer ? row + imageRows : row;
        const titleCell = sheet.getCell(`C${titleRow}`);
        titleCell.value = photo.title || photo.originalFilename;
        titleCell.font = { bold: true, size: 9 };
        titleCell.alignment = { wrapText: true, vertical: "top" };

        const descRow = titleRow + 1;
        const descCell = sheet.getCell(`C${descRow}`);
        descCell.value = photo.description || "";
        descCell.font = { size: 9 };
        descCell.alignment = { wrapText: true, vertical: "top" };
        sheet.getRow(descRow).height = 32;

        const linkRow = descRow + 1;
        const linkCell = sheet.getCell(`C${linkRow}`);
        const dropboxUrl = getEvidencePhotoDropboxUrl(photo);
        linkCell.value = {
          text: "View in Dropbox",
          hyperlink: dropboxUrl,
        };
        linkCell.font = { size: 9, color: { argb: "FF0563C1" }, underline: true };

        row = linkRow + 2;
      }
    }
  } catch (error) {
    console.error(`Failed to load photos for case ${caseRecord.shared.caseNumber}:`, error);
  }
  
  // Freeze the header rows
  sheet.views = [{ state: "frozen", xSplit: 0, ySplit: 3 }];
}

export async function POST(request: Request) {
  const sessionUser = await requireApiSession();
  if (!sessionUser) return unauthorizedResponse();
  
  try {
    // Get the filtered case IDs from the request body
    const body = await request.json();
    const requestedCaseIds = new Set(body.caseIds as string[] || []);
    
    const { records: allRecords, sessionUser: user, users } = await loadViewerCaseBundle();
    
    // Filter to only the requested cases (if provided)
    const records = requestedCaseIds.size > 0
      ? allRecords.filter((record) => requestedCaseIds.has(record.shared.id))
      : allRecords;
    
    if (records.length === 0) {
      return NextResponse.json(
        { error: "No cases found to export." },
        { status: 404 }
      );
    }
    
    // Get access token for photo downloads from server-side session
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token || "";
    
    if (!accessToken) {
      return NextResponse.json(
        { error: "Authentication token not available for photo download." },
        { status: 401 }
      );
    }
    
    const workbook = new ExcelJS.Workbook();
    workbook.creator = user.name || user.email;
    workbook.created = new Date();
    
    const sheetNames = new Set<string>();
    const caseSheetNames: Array<{ name: string; caseNumber: string; clientName: string }> = [];
    
    // Create a sheet for each case
    for (const caseRecord of records) {
      const baseName = `${caseRecord.shared.caseNumber} - ${caseRecord.shared.clientName}`;
      const sheetName = makeUniqueSheetName(baseName, sheetNames);
      caseSheetNames.push({
        name: sheetName,
        caseNumber: caseRecord.shared.caseNumber,
        clientName: caseRecord.shared.clientName,
      });
      
      await addCaseSheet(workbook, caseRecord, sheetName, accessToken, users);
    }
    
    // Add summary sheet at the beginning
    const summarySheet = workbook.addWorksheet("Summary", { state: "visible" });
    workbook.worksheets.forEach((ws, index) => {
      if (ws.name === "Summary") {
        workbook.worksheets.splice(index, 1);
        workbook.worksheets.unshift(ws);
      }
    });
    
    summarySheet.columns = [
      { width: 20 }, // Case Number
      { width: 40 }, // Client Name
      { width: 30 }, // Sheet Link
    ];
    
    summarySheet.getCell("A1").value = "Case Number";
    summarySheet.getCell("B1").value = "Client Name";
    summarySheet.getCell("C1").value = "Sheet";
    summarySheet.getRow(1).font = { bold: true };
    
    caseSheetNames.forEach((caseInfo, index) => {
      const row = index + 2;
      summarySheet.getCell(`A${row}`).value = caseInfo.caseNumber;
      summarySheet.getCell(`B${row}`).value = caseInfo.clientName;
      summarySheet.getCell(`C${row}`).value = {
        text: caseInfo.name,
        hyperlink: `#'${caseInfo.name.replace(/'/g, "''")}'!A1`,
      };
      summarySheet.getCell(`C${row}`).font = { color: { argb: "FF0000FF" }, underline: true };
    });
    
    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `Case_Summary_Report_${timestamp}.xlsx`;
    
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Excel export failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Excel export failed." },
      { status: 500 }
    );
  }
}
