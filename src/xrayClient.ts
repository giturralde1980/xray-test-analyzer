import config from './config';
import { Trace } from './filters';

interface TestExecutionResult {
  total: number;
  results: Array<any>;
}

const sampleTrace: Trace = {
  TraceId: '1-5f84c7a8-1234567890abcdef12345678',
  Segments: [
    {
      Id: 'abcdef1234567890',
      Document: JSON.stringify({
        name: 'integration-test-run',
        annotations: { testRunId: 'run-1234', evidenceCount: 0 },
        start_time: Date.now() / 1000,
        end_time: Date.now() / 1000 + 30
      })
    }
  ]
};

export async function fetchTraces(_options: { authToken?: string } = {}): Promise<Trace[]> {
  if (config.useSampleData) {
    return [sampleTrace];
  }
  return [sampleTrace];
}

async function fetchTestExecutionsPage(
  options: { authToken: string; jql: string; start: number; pageSize: number; xrayApiBaseUrl: string }
): Promise<TestExecutionResult> {
  const { authToken, jql, start, pageSize, xrayApiBaseUrl } = options;
  const escapedJql = jql.trim().replace(/\"/g, '\\"');
  const query = `{
    getTestExecutions(
      jql: "${escapedJql}"
      limit: ${pageSize}
      start: ${start}
    ) {
      total
      results {
        issueId
        projectId
        lastModified
        tests(limit: 50) {
          total
          results {
            issueId
            status { name }
          }
        }
        testRuns(limit: 50) {
          total
          results {
            id
            status { name }
            startedOn
            finishedOn
            executedById
            comment
            evidence { id filename size createdOn }
            steps { evidence { id filename size createdOn } }
          }
        }
      }
    }
  }`;

  const response = await fetch(`${xrayApiBaseUrl}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`getTestExecutions failed ${response.status}: ${text}`);
  }

  const payload = await response.json();

  if (payload.errors) {
    throw new Error(`getTestExecutions GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }

  return (payload.data?.getTestExecutions ?? { total: 0, results: [] }) as TestExecutionResult;
}

export async function fetchTestExecutions(
  options: { authToken: string; jql: string; limit?: number }
): Promise<TestExecutionResult> {
  const { authToken, jql } = options;
  const { xrayApiBaseUrl, useSampleData } = config;
  const PAGE_SIZE = 100;

  if (useSampleData) {
    return {
      total: 1,
      results: [
        {
          issueId: 'TESTEXEC-1',
          projectId: 'CHCCRM01',
          lastModified: new Date().toISOString(),
          tests: { total: 1, results: [{ issueId: 'TEST-1', status: { name: 'PASS' } }] },
          testRuns: {
            total: 1,
            results: [
              {
                id: 'TRUN-1',
                status: { name: 'PASS' },
                startedOn: new Date().toISOString(),
                finishedOn: new Date().toISOString(),
                executedById: 'user1',
                comment: 'sample run',
                evidence: []
              }
            ]
          }
        }
      ]
    };
  }

  if (!authToken) {
    throw new Error('authToken is required for Xray GraphQL calls');
  }

  console.log('fetchTestExecutions: posting query to', `${xrayApiBaseUrl}/graphql`);

  // First page — also tells us the total
  const firstPage = await fetchTestExecutionsPage({ authToken, jql, start: 0, pageSize: PAGE_SIZE, xrayApiBaseUrl });
  const total = firstPage.total;
  const allResults = [...firstPage.results];

  console.log(`fetchTestExecutions: total=${total}, fetched=${allResults.length} (page 1)`);

  // Keep fetching while we have more pages
  let start = PAGE_SIZE;
  let page = 2;
  while (allResults.length < total) {
    console.log(`fetchTestExecutions: fetching page ${page} (start=${start})...`);
    const nextPage = await fetchTestExecutionsPage({ authToken, jql, start, pageSize: PAGE_SIZE, xrayApiBaseUrl });
    allResults.push(...nextPage.results);
    start += PAGE_SIZE;
    page++;
  }

  console.log(`fetchTestExecutions: done — fetched ${allResults.length} of ${total} executions`);

  return { total, results: allResults };
}
