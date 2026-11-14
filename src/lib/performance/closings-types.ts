/** Client-safe closings drilldown shapes. */

export type ClosingCaseRef = {
  caseId: string;
  caseNumber: string;
  clientName: string;
  date: string;
  credit: number;
  note?: string;
};

export type PairClosingDetails = {
  pairId: string;
  settlements: ClosingCaseRef[];
  disbursements: ClosingCaseRef[];
};
