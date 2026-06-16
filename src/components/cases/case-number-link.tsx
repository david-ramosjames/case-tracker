import Link from "next/link";

export function CaseNumberLink({
  caseId,
  caseNumber,
  openInNewTab = false,
}: {
  caseId: string;
  caseNumber: string;
  openInNewTab?: boolean;
}) {
  return (
    <Link
      href={`/cases/${caseId}`}
      className="font-semibold text-pink-600 hover:text-pink-700 hover:underline"
      {...(openInNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {caseNumber}
    </Link>
  );
}
