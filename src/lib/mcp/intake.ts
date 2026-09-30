import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * DocketFlow intake columns exposed to Slackbot: accident, police, vehicle, insurance/claim,
 * treatment, and employment details. Identity documents (DOB, driver's license numbers),
 * family contacts, and the raw call transcript are intentionally excluded.
 */
const INTAKE_COLUMNS = [
  "created_at",
  "representation_date",
  "how_found",
  "accident_date",
  "accident_time",
  "accident_location",
  "city",
  "county",
  "accident_description",
  "passengers",
  "police_department",
  "police_report_no",
  "ticket_issued",
  "ticket_who",
  "ticket_reason",
  "vehicle",
  "vehicle_owner",
  "drivable",
  "towed",
  "towed_by",
  "vehicle_location",
  "has_loan",
  "lienholder",
  "rental_needed",
  "body_shop",
  "other_driver_name",
  "other_driver_phone",
  "other_driver_car_owner",
  "client_insurance",
  "client_policy_no",
  "client_claim_no",
  "third_party_insurance",
  "third_party_policy_no",
  "third_party_claim_no",
  "pip",
  "med_pay",
  "um_uim",
  "ems",
  "hospital",
  "hospital_bill",
  "treating_doctor",
  "injury_types",
  "health_insurance",
  "medicaid",
  "medicare",
  "employer",
  "job_description",
  "missed_work",
  "salary_rate",
  "notes",
  "slack_permalink",
] as const;

/** Most recent DocketFlow intake for a case, with empty fields dropped. */
export async function getCaseIntakeSummary(caseId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("intakes")
    .select(INTAKE_COLUMNS.join(","))
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  return Object.fromEntries(
    Object.entries(data as unknown as Record<string, unknown>).filter(
      ([, value]) => value !== null && value !== "" && !(typeof value === "string" && !value.trim()),
    ),
  );
}
