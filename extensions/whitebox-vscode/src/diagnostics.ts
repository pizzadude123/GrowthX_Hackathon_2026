export type StoredDiagnostic = {
  path: string; startLine: number; endLine: number; severity: 'information'|'warning'|'error'; title?: string;
  flowLabel?: string; principleStatement?: string; impact?: string; status?: string; confidence?: number;
  dashboardUrl?: string; githubPermalink?: string;
};
export function activeDiagnostics<T extends {status?:string;confidence?:number;severity:string}>(rows:T[]) {
  return rows.filter((row) => row.status !== 'rejected' && (row.confidence ?? .9) >= .8 && row.severity !== 'information');
}
