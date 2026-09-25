import type { Cell } from './analytics';
export type ImportIssue = { severity:'info'|'warning'; message:string; source?:string };
export type ImportReport = {
 layout:'table'|'matrix'|'ledger'; sheet:string; range:string; headerRow:number;
 originalRows:number; activeRows:number; ignoredFormattedRows:number;
 changes:string[]; issues:ImportIssue[]; preview:{row:number;cells:Cell[]}[];
 duplicateRows:number; formulaCount:number; formulaErrors:number; missingFormulaResults:number;
};
export type FinancialMetric = { id:string; label:string; currency:string; unit:'currency'|'number'|'percent'; aggregation:'sum'|'last'; role?:'receipts'|'payments'|'balance'|'opening' };
export type FinancialProfile = { metrics:FinancialMetric[]; granularity:'annual'|'monthly'|'daily'; basis:'projection'|'recorded'|'unspecified'; title:string };
export type RawRow = { row:number; values:Cell[]; formats:string[]; formulas:(string|null)[] };
export type RawSheet = { name:string; rows:RawRow[]; originalRows:number; formulaCount:number; formulaErrors:number; missingFormulaResults:number; issues:ImportIssue[] };
