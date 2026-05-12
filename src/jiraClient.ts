import config from './config';

export interface JiraIssueInfo {
  issueId: string;
  key: string;
  summary: string;
  priority: string;
}

const JIRA_BATCH_SIZE = 100;

export async function fetchJiraIssuesByIds(
  ids: string[],
  label = 'Jira'
): Promise<Map<string, JiraIssueInfo>> {
  const result = new Map<string, JiraIssueInfo>();
  const { jiraBaseUrl, jiraAuthToken } = config;

  if (!jiraBaseUrl || !jiraAuthToken) {
    console.warn('Jira credentials not configured — skipping Jira enrichment.');
    return result;
  }

  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return result;

  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Basic ${jiraAuthToken}`
  };
  const url = `${jiraBaseUrl}/rest/api/3/search/jql`;

  for (let i = 0; i < uniqueIds.length; i += JIRA_BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + JIRA_BATCH_SIZE);
    const jql = `id IN (${batch.join(',')})`;
    const batchNum = i / JIRA_BATCH_SIZE + 1;

    try {
      console.log(`${label} JQL (batch ${batchNum}): ${jql}`);
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jql, fields: ['summary', 'priority'], maxResults: JIRA_BATCH_SIZE })
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn(`${label} bulk search failed (batch ${batchNum}): ${res.status} ${text}`);
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
      console.log(`${label} bulk fetch batch ${batchNum}: ${data.issues?.length ?? 0} issues returned (${batch.length} requested)`);
    } catch (err) {
      console.warn(`Error in ${label} bulk search (batch ${batchNum}):`, err);
    }
  }

  console.log(`${label} enrichment complete: ${result.size} issues fetched in ${Math.ceil(uniqueIds.length / JIRA_BATCH_SIZE)} call(s).`);
  return result;
}

export async function fetchJiraIssuesForExecutions(
  executionKeys: string[]
): Promise<Map<string, JiraIssueInfo>> {
  const ids = executionKeys
    .map((key) => {
      const colonIdx = key.indexOf(':');
      return colonIdx !== -1 ? key.slice(colonIdx + 1) : null;
    })
    .filter((id): id is string => id !== null);

  return fetchJiraIssuesByIds(ids, 'Jira');
}
