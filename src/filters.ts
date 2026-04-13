export interface TraceSegmentDoc {
  name?: string;
  annotations?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface TraceSegment {
  Id: string;
  Document: string;
}

export interface Trace {
  TraceId: string;
  Segments: TraceSegment[];
}

export interface TestRunNoEvidenceRow {
  execution: string;
  testRunId: string;
  status?: string;
  startedOn?: string;
  finishedOn?: string;
  executedById?: string;
  comment?: string;
}

function parseSegment(trace: Trace): TraceSegmentDoc | null {
  const raw = trace?.Segments?.[0]?.Document;
  if (!raw) return null;

  try {
    return JSON.parse(raw) as TraceSegmentDoc;
  } catch {
    return null;
  }
}

export function getTestRunIdFromTrace(trace: Trace): string | null {
  const segment = parseSegment(trace);
  if (!segment) return null;

  if (segment.annotations?.testRunId) {
    return String(segment.annotations.testRunId);
  }

  if (segment.name && segment.name.toLowerCase().includes('test')) {
    return segment.name;
  }

  return null;
}

export function hasEvidence(trace: Trace): boolean {
  const segment = parseSegment(trace);
  if (!segment) return false;

  const evidence = Number(segment.annotations?.evidenceCount ?? segment.metadata?.evidenceCount ?? 0);
  return evidence > 0;
}

export function findNoEvidenceTestRuns(traces: Trace[]): Array<{ traceId: string; testRunId: string }> {
  return traces
    .map((trace) => ({ trace, testRunId: getTestRunIdFromTrace(trace) }))
    .filter((x) => x.testRunId && !hasEvidence(x.trace))
    .map((x) => ({ traceId: x.trace.TraceId, testRunId: x.testRunId! }));
}

const COMPLETED_STATUSES = new Set(['PASSED', 'PASS', 'FAILED', 'FAIL']);

function buildRow(executionKey: string, tr: any): TestRunNoEvidenceRow {
  return {
    execution: executionKey,
    testRunId: String(tr.id ?? 'unknown'),
    status: tr.status?.name,
    startedOn: tr.startedOn,
    finishedOn: tr.finishedOn,
    executedById: tr.executedById,
    comment: tr.comment
  };
}

function checkEvidence(tr: any): boolean {
  return (
    (Array.isArray(tr.evidence) && tr.evidence.length > 0) ||
    (Array.isArray(tr.steps) && tr.steps.some((s: any) => Array.isArray(s.evidence) && s.evidence.length > 0))
  );
}

export function findNoEvidenceTestRunsInExecutions(
  executions: Array<any>
): TestRunNoEvidenceRow[] {
  if (!Array.isArray(executions)) return [];
  const rows: TestRunNoEvidenceRow[] = [];
  executions.forEach((exec) => {
    const executionKey = `${exec.projectId ?? 'unknown'}:${exec.issueId ?? 'unknown'}`;
    (exec.testRuns?.results ?? []).forEach((tr: any) => {
      const status = (tr.status?.name ?? '').toUpperCase();
      if (!COMPLETED_STATUSES.has(status)) return;
      if (!checkEvidence(tr)) rows.push(buildRow(executionKey, tr));
    });
  });
  return rows;
}

export function findWithEvidenceTestRunsInExecutions(
  executions: Array<any>
): TestRunNoEvidenceRow[] {
  if (!Array.isArray(executions)) return [];
  const rows: TestRunNoEvidenceRow[] = [];
  executions.forEach((exec) => {
    const executionKey = `${exec.projectId ?? 'unknown'}:${exec.issueId ?? 'unknown'}`;
    (exec.testRuns?.results ?? []).forEach((tr: any) => {
      const status = (tr.status?.name ?? '').toUpperCase();
      if (status !== 'PASSED' && status !== 'PASS') return;
      if (checkEvidence(tr)) rows.push(buildRow(executionKey, tr));
    });
  });
  return rows;
}
