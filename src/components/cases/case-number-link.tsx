import Link from "next/link";

export function CaseNumberLink({ caseId, caseNumber }: { caseId: string; caseNumber: string }) {
  return (
    <Link href={`/cases/${caseId}`} className="font-semibold text-pink-600 hover:text-pink-700 hover:underline">
      {caseNumber}
    </Link>
  );
}
