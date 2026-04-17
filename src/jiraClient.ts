import config from './config';

export interface JiraIssueInfo {
  issueId: string;
  key: string;
  summary: string;
  priority: string;
}

const JIRA_BATCH_SIZE = 100; // max results per search page

/**
 * Fetches Jira info for a list of numeric issue IDs in bulk.
 *
 * Uses POST /rest/api/3/search/jql with JQL "id IN (id1,id2,...)" so the
 * entire set is retrieved in ceil(uniqueIds / 100) calls instead of one
 * call per row. The returned map is keyed by numeric issueId.
 */
export async function fetchJiraIssuesForExecutions(
  executionKeys: string[]
): Promise<Map<string, JiraIssueInfo>> {
  const result = new Map<string, JiraIssueInfo>();
  const { jiraBaseUrl, jiraAuthToken } = config;

  if (!jiraBaseUrl || !jiraAuthToken) {
    console.warn('Jira credentials not configured — skipping Jira enrichment.');
    return result;
  }

  const uniqueIssueIds = Array.from(
    new Set(
      executionKeys
        .map((key) => {
          const colonIdx = key.indexOf(':');
          return colonIdx !== -1 ? key.slice(colonIdx + 1) : null;
        })
        .filter((id): id is string => id !== null)
    )
  );

  if (uniqueIssueIds.length === 0) return result;

  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Basic ${jiraAuthToken}`
  };

  const url = `${jiraBaseUrl}/rest/api/3/search/jql`;

  // Chunk into batches of JIRA_BATCH_SIZE and fetch sequentially to avoid
  // hitting rate limits — each batch is one HTTP call.
  for (let i = 0; i < uniqueIssueIds.length; i += JIRA_BATCH_SIZE) {
    const batch = uniqueIssueIds.slice(i, i + JIRA_BATCH_SIZE);
    const jql = `id IN (${batch.join(',')})`;

    try {
      console.log(`Jira JQL (batch ${i / JIRA_BATCH_SIZE + 1}): ${jql}`);
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jql,
          fields: ['summary', 'priority'],
          maxResults: JIRA_BATCH_SIZE
        })
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn(`Jira bulk search failed (batch ${i / JIRA_BATCH_SIZE + 1}): ${res.status} ${text}`);
        continue;
      }

      const data = await res.json();
      for (const issue of data.issues ?? []) {
        result.set(String(issue.id), {
          issueId: String(issue.id),
          key: issue.key || '—',
          summary: issue.fields?.summary || '—',
          priority: issue.fields?.priority?.name || '—'
        });
      }

      console.log(
        `Jira bulk fetch batch ${i / JIRA_BATCH_SIZE + 1}: ` +
        `${data.issues?.length ?? 0} issues returned (${batch.length} requested)`
      );
    } catch (err) {
      console.warn(`Error in Jira bulk search (batch ${i / JIRA_BATCH_SIZE + 1}):`, err);
    }
  }

  console.log(`Jira enrichment complete: ${result.size} issues fetched in ${Math.ceil(uniqueIssueIds.length / JIRA_BATCH_SIZE)} call(s).`);
  return result;
}

/**
 * Fetches bugs filed in Jira for a given release label.
 * Uses JQL: labels = "{releaseVersion}" AND issuetype = "Bug"
 * Returns total count and the list of issue keys.
 */
export async function fetchJiraBugsForRelease(
  releaseVersion: string
): Promise<{ total: number; keys: string[] }> {
  const { jiraBaseUrl, jiraAuthToken } = config;

  if (!jiraBaseUrl || !jiraAuthToken) {
    console.warn('Jira credentials not configured — skipping bug count.');
    return { total: 0, keys: [] };
  }

  const jql = `labels = "${releaseVersion}" AND issuetype = "Bug"`;
  const url = `${jiraBaseUrl}/rest/api/3/search/jql`;

  try {
    console.log(`Jira bug query: ${jql}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${jiraAuthToken}`
      },
      body: JSON.stringify({ jql, fields: ['summary'], maxResults: 100 })
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`Jira bug query failed: ${res.status} ${text}`);
      return { total: 0, keys: [] };
    }

    const data = await res.json();
    const keys = (data.issues ?? []).map((i: any) => i.key as string);
    console.log(`Jira bugs for ${releaseVersion}: ${data.total ?? keys.length} total`);
    return { total: data.total ?? keys.length, keys };
  } catch (err) {
    console.warn('Error fetching Jira bugs:', err);
    return { total: 0, keys: [] };
  }
}
