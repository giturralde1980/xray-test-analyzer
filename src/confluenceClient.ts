import config from './config';

export interface ConfluencePageResult {
  id: string;
  title: string;
  url: string;
}

interface ConfluencePageData {
  releaseVersion: string;
  totalExecutions: number;
  totalTestRuns: number;
  passedCount: number;
  failedCount: number;
  executingCount: number;
  todoCount: number;
  zeroDurationRuns: number;
  longDurationRuns: number;
  avgDuration: number;
  passedWithEvidence: number;
  passedWithoutEvidence: number;
  statusCounts: Record<string, number>;
  noEvidenceRows: Array<{ jiraKey: string; jiraSummary: string; jiraPriority: string; status: string }>;
  timestamp: string;
  htmlContent?: string;
  htmlFilename?: string;
}

// ── SVG generators ──────────────────────────────────────────────────────────

function generateStatusDonutChart(statusCounts: Record<string, number>, total: number): string {
  const COLORS: Record<string, string> = {
    PASSED: '#10b981', PASS: '#10b981',
    FAILED: '#ef4444', FAIL: '#ef4444',
    'TO DO': '#f59e0b', TODO: '#f59e0b',
    EXECUTING: '#8b5cf6'
  };

  const entries = Object.entries(statusCounts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const CX = 130, CY = 145, R = 105, IR = 62;
  let angle = -Math.PI / 2;

  let paths: string;

  if (entries.length === 1) {
    const color = COLORS[entries[0][0].toUpperCase()] || '#64748b';
    paths = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="${color}"/>
  <circle cx="${CX}" cy="${CY}" r="${IR}" fill="white"/>`;
  } else {
    paths = entries.map(([label, value]) => {
      const sweep = (value / total) * 2 * Math.PI;
      const sa = angle;
      angle += sweep;
      const ea = angle;
      const la = sweep > Math.PI ? 1 : 0;
      const color = COLORS[label.toUpperCase()] || '#64748b';

      const ox1 = (CX + R * Math.cos(sa)).toFixed(2);
      const oy1 = (CY + R * Math.sin(sa)).toFixed(2);
      const ox2 = (CX + R * Math.cos(ea)).toFixed(2);
      const oy2 = (CY + R * Math.sin(ea)).toFixed(2);
      const ix1 = (CX + IR * Math.cos(ea)).toFixed(2);
      const iy1 = (CY + IR * Math.sin(ea)).toFixed(2);
      const ix2 = (CX + IR * Math.cos(sa)).toFixed(2);
      const iy2 = (CY + IR * Math.sin(sa)).toFixed(2);

      const d = `M ${ox1} ${oy1} A ${R} ${R} 0 ${la} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${IR} ${IR} 0 ${la} 0 ${ix2} ${iy2} Z`;
      return `<path d="${d}" fill="${color}" stroke="white" stroke-width="2"/>`;
    }).join('\n  ');
  }

  const legend = entries.map(([label, value], i) => {
    const color = COLORS[label.toUpperCase()] || '#64748b';
    const pct = ((value / total) * 100).toFixed(1);
    const y = 50 + i * 34;
    return `<rect x="285" y="${y}" width="14" height="14" fill="${color}" rx="3"/>
  <text x="305" y="${y + 11}" font-size="13" fill="#475569">${label}: <tspan font-weight="bold" fill="#1e293b">${value}</tspan> <tspan fill="#94a3b8">(${pct}%)</tspan></text>`;
  }).join('\n  ');

  return `<svg width="540" height="290" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe UI',Arial,sans-serif">
  <text x="0" y="24" font-size="15" font-weight="bold" fill="#0284c7">Test Status Distribution</text>
  ${paths}
  <text x="${CX}" y="${CY - 8}" text-anchor="middle" font-size="26" font-weight="bold" fill="#0f172a">${total}</text>
  <text x="${CX}" y="${CY + 14}" text-anchor="middle" font-size="11" fill="#94a3b8">total runs</text>
  ${legend}
</svg>`;
}

function generateEvidenceBarChart(withEvidence: number, withoutEvidence: number): string {
  const maxVal = Math.max(withEvidence, withoutEvidence, 1);
  const BAR_MAX = 340;
  const wBar = Math.round((withEvidence / maxVal) * BAR_MAX);
  const woBar = Math.round((withoutEvidence / maxVal) * BAR_MAX);
  const total = withEvidence + withoutEvidence || 1;
  const pct = ((withEvidence / total) * 100).toFixed(1);

  return `<svg width="560" height="200" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe UI',Arial,sans-serif">
  <text x="0" y="24" font-size="15" font-weight="bold" fill="#0284c7">Evidence Coverage — Passed Runs</text>

  <text x="0" y="68" font-size="12" fill="#475569">With Evidence</text>
  <rect x="158" y="52" width="${wBar}" height="28" fill="#10b981" rx="5"/>
  ${wBar > 30 ? `<text x="${158 + wBar - 8}" y="71" text-anchor="end" font-size="12" font-weight="bold" fill="white">${withEvidence}</text>` : `<text x="${158 + wBar + 8}" y="71" font-size="12" font-weight="bold" fill="#10b981">${withEvidence}</text>`}

  <text x="0" y="124" font-size="12" fill="#475569">Without Evidence</text>
  <rect x="158" y="108" width="${woBar}" height="28" fill="#ef4444" rx="5"/>
  ${woBar > 30 ? `<text x="${158 + woBar - 8}" y="127" text-anchor="end" font-size="12" font-weight="bold" fill="white">${withoutEvidence}</text>` : `<text x="${158 + woBar + 8}" y="127" font-size="12" font-weight="bold" fill="#ef4444">${withoutEvidence}</text>`}

  <line x1="0" y1="155" x2="540" y2="155" stroke="#e2e8f0" stroke-width="1"/>
  <text x="0" y="178" font-size="12" fill="#64748b">Coverage: <tspan font-weight="bold" fill="#0284c7">${pct}%</tspan> of passed tests have attached proof</text>
</svg>`;
}

// ── Attachment upload ────────────────────────────────────────────────────────

async function uploadAttachment(
  pageId: string,
  filename: string,
  content: string,
  mimeType: string,
  authToken: string,
  apiBase: string
): Promise<void> {
  const formData = new FormData();
  formData.append('file', new Blob([content], { type: mimeType }), filename);
  formData.append('minorEdit', 'true');

  const res = await fetch(`${apiBase}/${pageId}/child/attachment?allowDuplicated=true`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authToken}`,
      'X-Atlassian-Token': 'no-check'
    },
    body: formData
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`Failed to upload attachment ${filename}: ${res.status} ${text}`);
  } else {
    console.log(`Uploaded attachment: ${filename}`);
  }
}

// ── Storage format builder ───────────────────────────────────────────────────

function buildStorageFormat(data: ConfluencePageData, passRate: string, evidenceRate: string): string {
  // KPI panels — row 1
  const kpiRow1 = `
<ac:layout>
  <ac:layout-section ac:type="three_equal">
    <ac:layout-cell>
      <ac:structured-macro ac:name="panel">
        <ac:parameter ac:name="borderColor">#10b981</ac:parameter>
        <ac:parameter ac:name="titleBGColor">#f0fdf4</ac:parameter>
        <ac:parameter ac:name="title">Pass Rate</ac:parameter>
        <ac:rich-text-body>
          <p style="font-size:2em;font-weight:bold;color:#10b981;text-align:center;margin:0.4em 0">${passRate}%</p>
          <p style="text-align:center;color:#64748b">${data.passedCount} / ${data.totalTestRuns} passed</p>
        </ac:rich-text-body>
      </ac:structured-macro>
    </ac:layout-cell>
    <ac:layout-cell>
      <ac:structured-macro ac:name="panel">
        <ac:parameter ac:name="borderColor">#0369a1</ac:parameter>
        <ac:parameter ac:name="titleBGColor">#eff6ff</ac:parameter>
        <ac:parameter ac:name="title">Evidence Coverage (Passed)</ac:parameter>
        <ac:rich-text-body>
          <p style="font-size:2em;font-weight:bold;color:#0369a1;text-align:center;margin:0.4em 0">${evidenceRate}%</p>
          <p style="text-align:center;color:#64748b">${data.passedWithEvidence} of ${data.passedWithEvidence + data.passedWithoutEvidence} with proof</p>
        </ac:rich-text-body>
      </ac:structured-macro>
    </ac:layout-cell>
    <ac:layout-cell>
      <ac:structured-macro ac:name="panel">
        <ac:parameter ac:name="borderColor">#64748b</ac:parameter>
        <ac:parameter ac:name="titleBGColor">#f8fafc</ac:parameter>
        <ac:parameter ac:name="title">Total Test Runs</ac:parameter>
        <ac:rich-text-body>
          <p style="font-size:2em;font-weight:bold;color:#334155;text-align:center;margin:0.4em 0">${data.totalTestRuns}</p>
          <p style="text-align:center;color:#64748b">${data.totalExecutions} executions</p>
        </ac:rich-text-body>
      </ac:structured-macro>
    </ac:layout-cell>
  </ac:layout-section>
</ac:layout>`;

  // KPI panels — row 2
  const failBorderColor = data.failedCount > 0 ? '#ef4444' : '#10b981';
  const failBgColor = data.failedCount > 0 ? '#fff5f5' : '#f0fdf4';
  const failValueColor = data.failedCount > 0 ? '#ef4444' : '#10b981';
  const failSubtext = data.failedCount > 0 ? 'Require attention' : 'No failures';

  const kpiRow2 = `
<ac:layout>
  <ac:layout-section ac:type="three_equal">
    <ac:layout-cell>
      <ac:structured-macro ac:name="panel">
        <ac:parameter ac:name="borderColor">${failBorderColor}</ac:parameter>
        <ac:parameter ac:name="titleBGColor">${failBgColor}</ac:parameter>
        <ac:parameter ac:name="title">Failed</ac:parameter>
        <ac:rich-text-body>
          <p style="font-size:2em;font-weight:bold;color:${failValueColor};text-align:center;margin:0.4em 0">${data.failedCount}</p>
          <p style="text-align:center;color:#64748b">${failSubtext}</p>
        </ac:rich-text-body>
      </ac:structured-macro>
    </ac:layout-cell>
    <ac:layout-cell>
      <ac:structured-macro ac:name="panel">
        <ac:parameter ac:name="borderColor">#8b5cf6</ac:parameter>
        <ac:parameter ac:name="titleBGColor">#faf5ff</ac:parameter>
        <ac:parameter ac:name="title">Executing</ac:parameter>
        <ac:rich-text-body>
          <p style="font-size:2em;font-weight:bold;color:#8b5cf6;text-align:center;margin:0.4em 0">${data.executingCount}</p>
          <p style="text-align:center;color:#64748b">In progress</p>
        </ac:rich-text-body>
      </ac:structured-macro>
    </ac:layout-cell>
    <ac:layout-cell>
      <ac:structured-macro ac:name="panel">
        <ac:parameter ac:name="borderColor">#f59e0b</ac:parameter>
        <ac:parameter ac:name="titleBGColor">#fffbeb</ac:parameter>
        <ac:parameter ac:name="title">Pending (TO DO)</ac:parameter>
        <ac:rich-text-body>
          <p style="font-size:2em;font-weight:bold;color:#f59e0b;text-align:center;margin:0.4em 0">${data.todoCount}</p>
          <p style="text-align:center;color:#64748b">To execute</p>
        </ac:rich-text-body>
      </ac:structured-macro>
    </ac:layout-cell>
  </ac:layout-section>
</ac:layout>`;

  // Alert banners
  const alerts: string[] = [];
  if (data.failedCount > 0) {
    alerts.push(`<ac:structured-macro ac:name="warning">
  <ac:parameter ac:name="title">Failed Test Runs Detected</ac:parameter>
  <ac:rich-text-body><p>${data.failedCount} test run(s) failed and require immediate attention.</p></ac:rich-text-body>
</ac:structured-macro>`);
  }
  if (parseFloat(evidenceRate) < 50) {
    alerts.push(`<ac:structured-macro ac:name="note">
  <ac:parameter ac:name="title">Low Evidence Coverage</ac:parameter>
  <ac:rich-text-body><p>Only ${evidenceRate}% of passed tests have attached evidence. Review the ${data.passedWithoutEvidence} test run(s) listed below.</p></ac:rich-text-body>
</ac:structured-macro>`);
  }

  // Charts embedded as attachments
  const chartsSection = `
<ac:layout>
  <ac:layout-section ac:type="two_equal">
    <ac:layout-cell>
      <ac:image ac:width="520"><ri:attachment ri:filename="chart-status.svg" /></ac:image>
    </ac:layout-cell>
    <ac:layout-cell>
      <ac:image ac:width="520"><ri:attachment ri:filename="chart-evidence.svg" /></ac:image>
    </ac:layout-cell>
  </ac:layout-section>
</ac:layout>`;

  // Additional metrics table
  const zeroDurColor = data.zeroDurationRuns > 0 ? 'Yellow' : 'Green';
  const longDurColor = data.longDurationRuns > 0 ? 'Yellow' : 'Green';

  const metricsTable = `<h2>Additional Metrics</h2>
<table>
  <tbody>
    <tr><th>Metric</th><th>Value</th><th>Note</th></tr>
    <tr>
      <td>Avg Duration</td>
      <td><strong>${data.avgDuration.toFixed(1)} min</strong></td>
      <td>${(data.avgDuration / 60).toFixed(2)}h per execution</td>
    </tr>
    <tr>
      <td>Suspicious &mdash; Zero Duration</td>
      <td><ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${zeroDurColor}</ac:parameter><ac:parameter ac:name="title">${data.zeroDurationRuns}</ac:parameter></ac:structured-macro></td>
      <td>Ran in 0 min &mdash; likely not executed</td>
    </tr>
    <tr>
      <td>Suspicious &mdash; Over 8h</td>
      <td><ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${longDurColor}</ac:parameter><ac:parameter ac:name="title">${data.longDurationRuns}</ac:parameter></ac:structured-macro></td>
      <td>Duration &gt; 8h &mdash; possible data issue</td>
    </tr>
  </tbody>
</table>`;

  // No evidence table
  const passedNoEvidence = data.noEvidenceRows.filter(r => (r.status || '').toUpperCase() === 'PASSED');
  const rowsToShow = passedNoEvidence.slice(0, 100);

  const noEvidenceSection = passedNoEvidence.length > 0
    ? `<h2>Passed Without Evidence (${passedNoEvidence.length})</h2>
<ac:structured-macro ac:name="note">
  <ac:rich-text-body><p>These test runs are marked <strong>PASSED</strong> but have no evidence files attached.</p></ac:rich-text-body>
</ac:structured-macro>
<table>
  <tbody>
    <tr><th>Jira Key</th><th>Summary</th><th>Priority</th><th>Status</th></tr>
    ${rowsToShow.map(r => `
    <tr>
      <td><a href="${config.jiraBaseUrl}/browse/${r.jiraKey}">${r.jiraKey}</a></td>
      <td>${r.jiraSummary}</td>
      <td>${r.jiraPriority}</td>
      <td><ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">PASSED</ac:parameter></ac:structured-macro></td>
    </tr>`).join('')}
  </tbody>
</table>
${passedNoEvidence.length > 100 ? `<p><em>Showing first 100 of ${passedNoEvidence.length} records.</em></p>` : ''}`
    : `<ac:structured-macro ac:name="info">
  <ac:parameter ac:name="title">Full Evidence Coverage</ac:parameter>
  <ac:rich-text-body><p>All passed test runs have evidence attached.</p></ac:rich-text-body>
</ac:structured-macro>`;

  const reportLink = data.htmlFilename
    ? `\n<ac:structured-macro ac:name="info">
  <ac:rich-text-body><p>Full interactive dashboard: <ac:link><ri:attachment ri:filename="${data.htmlFilename}" /><ac:plain-text-link-body><![CDATA[Download HTML Report]]></ac:plain-text-link-body></ac:link></p></ac:rich-text-body>
</ac:structured-macro>`
    : '';

  return `<p><strong>Release:</strong> ${data.releaseVersion} &nbsp;&mdash;&nbsp; <strong>Generated:</strong> ${data.timestamp}</p>
${reportLink}
${kpiRow1}
${kpiRow2}
${alerts.join('\n')}
<h2>Charts</h2>
${chartsSection}
${metricsTable}
${noEvidenceSection}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function createConfluencePage(data: ConfluencePageData): Promise<ConfluencePageResult | null> {
  const { jiraBaseUrl, jiraAuthToken, confluenceSpaceKey, confluenceParentPageId } = config;

  if (!jiraBaseUrl || !jiraAuthToken || !confluenceSpaceKey) {
    console.warn('Confluence config missing (CONFLUENCE_SPACE_KEY required) — skipping page creation.');
    return null;
  }

  const passedTotal = data.passedWithEvidence + data.passedWithoutEvidence;
  const passRate = data.totalTestRuns ? ((data.passedCount / data.totalTestRuns) * 100).toFixed(1) : '0.0';
  const evidenceRate = passedTotal ? ((data.passedWithEvidence / passedTotal) * 100).toFixed(1) : '0.0';

  const today = new Date().toISOString().slice(0, 10);
  const title = `XRay Evidence - ${data.releaseVersion} - ${today}`;
  const storageBody = buildStorageFormat(data, passRate, evidenceRate);

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Basic ${jiraAuthToken}`
  };

  const apiBase = `${jiraBaseUrl}/wiki/rest/api/content`;

  let pageId: string | null = null;
  let pageUrl = '';

  // Check if page already exists and update it
  try {
    const searchUrl = `${apiBase}?title=${encodeURIComponent(title)}&spaceKey=${confluenceSpaceKey}&expand=version`;
    const searchRes = await fetch(searchUrl, { headers });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.results?.length > 0) {
        const existing = searchData.results[0];
        const currentVersion = existing.version?.number || 1;

        const updateRes = await fetch(`${apiBase}/${existing.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            version: { number: currentVersion + 1 },
            title,
            type: 'page',
            body: { storage: { value: storageBody, representation: 'storage' } }
          })
        });

        if (!updateRes.ok) {
          const text = await updateRes.text();
          console.error(`Failed to update Confluence page: ${updateRes.status} ${text}`);
          return null;
        }

        const updated = await updateRes.json();
        pageId = updated.id;
        pageUrl = `${jiraBaseUrl}/wiki${updated._links?.webui || `/spaces/${confluenceSpaceKey}/pages/${pageId}`}`;
        console.log(`Confluence page updated: ${pageUrl}`);
      }
    }
  } catch (err) {
    console.warn('Error checking for existing Confluence page:', err);
  }

  // Create new page if it doesn't exist yet
  if (!pageId) {
    const payload: Record<string, unknown> = {
      type: 'page',
      title,
      space: { key: confluenceSpaceKey },
      body: { storage: { value: storageBody, representation: 'storage' } }
    };

    if (confluenceParentPageId) {
      payload.ancestors = [{ id: confluenceParentPageId }];
    }

    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`Failed to create Confluence page: ${res.status} ${text}`);
        return null;
      }

      const created = await res.json();
      pageId = created.id;
      pageUrl = `${jiraBaseUrl}/wiki${created._links?.webui || `/spaces/${confluenceSpaceKey}/pages/${pageId}`}`;
      console.log(`Confluence page created: ${pageUrl}`);
    } catch (err) {
      console.error('Error creating Confluence page:', err);
      return null;
    }
  }

  // Upload chart SVG attachments
  const totalRuns = data.totalTestRuns || 1;
  const statusSvg = generateStatusDonutChart(data.statusCounts, totalRuns);
  const evidenceSvg = generateEvidenceBarChart(data.passedWithEvidence, data.passedWithoutEvidence);

  await uploadAttachment(pageId!, 'chart-status.svg', statusSvg, 'image/svg+xml', jiraAuthToken, apiBase);
  await uploadAttachment(pageId!, 'chart-evidence.svg', evidenceSvg, 'image/svg+xml', jiraAuthToken, apiBase);

  if (data.htmlContent && data.htmlFilename) {
    await uploadAttachment(pageId!, data.htmlFilename, data.htmlContent, 'text/html', jiraAuthToken, apiBase);
  }

  return { id: pageId!, title, url: pageUrl };
}
