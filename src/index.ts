import fs from 'fs';
import path from 'path';

import config from './config';
import { fetchTestExecutions } from './xrayClient';
import { getXrayToken } from './xrayAuth';
import { findNoEvidenceTestRunsInExecutions, findWithEvidenceTestRunsInExecutions } from './filters';
import { fetchJiraIssuesForExecutions } from './jiraClient';

interface ReportData {
  totalExecutions: number;
  emptyExecutions: number;
  totalTestRuns: number;
  noEvidenceCount: number;
  statusCounts: Record<string, number>;
  breakdown: {
    passedWithEvidence: number;
    passedWithoutEvidence: number;
    failedWithEvidence: number;
    failedWithoutEvidence: number;
    toDo: number;
    executing: number;
  };
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  zeroDurationRuns: number;
  longDurationRuns: number;
  executorPerformance: Array<{ name: string; total: number; passed: number; passRate: number }>;
  dateDistribution: Array<{ date: string; count: number }>;
  noEvidenceRows: Array<any>;
  withEvidenceRows: Array<any>;
  timestamp: string;
  releaseVersion: string;
}

function generateHtmlReport(data: ReportData): string {
  const passedCount = data.statusCounts['PASSED'] || data.statusCounts['PASS'] || 0;
  const failedCount = data.statusCounts['FAILED'] || data.statusCounts['FAIL'] || 0;
  const todoCount = data.breakdown.toDo;
  const executingCount = data.breakdown.executing;

  const passRate = data.totalTestRuns ? ((passedCount / data.totalTestRuns) * 100).toFixed(1) : '0.0';
  const passedWithEvidence = data.breakdown.passedWithEvidence;
  const passedWithoutEvidence = data.breakdown.passedWithoutEvidence;
  const passedTotal = passedWithEvidence + passedWithoutEvidence;
  const evidenceRate = passedTotal ? ((passedWithEvidence / passedTotal) * 100).toFixed(1) : '0.0';

  const filteredRows = data.noEvidenceRows.filter((row) => (row.status || '').toUpperCase() === 'PASSED');

  const formatDuration = (started?: string, finished?: string): string => {
    if (!started || !finished) return '—';
    const start = new Date(started);
    const end = new Date(finished);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    return `${minutes} min`;
  };

  const statusColors: Record<string, string> = {
    PASSED: '#10b981', PASS: '#10b981',
    FAILED: '#ef4444', FAIL: '#ef4444',
    'TO DO': '#f59e0b', TODO: '#f59e0b',
    EXECUTING: '#8b5cf6'
  };

  const statusLabels = Object.keys(data.statusCounts);
  const statusData = Object.values(data.statusCounts);
  const statusBgColors = statusLabels.map(l => statusColors[l.toUpperCase()] || '#64748b');

  const serializeRows = (rows: any[]) => JSON.stringify(
    rows
      .sort((a, b) => {
        const keyA = (a.jiraKey || '').localeCompare(b.jiraKey || '');
        if (keyA !== 0) return keyA;
        return (a.jiraSummary || '').localeCompare(b.jiraSummary || '');
      })
      .map((row) => {
        const dur = formatDuration(row.startedOn, row.finishedOn);
        return {
          status: row.status || 'Unknown',
          startedOn: row.startedOn || '—',
          finishedOn: row.finishedOn || '—',
          comment: row.comment || '—',
          duration: dur,
          zeroDur: dur === '0 min',
          jiraKey: row.jiraKey || '—',
          jiraSummary: row.jiraSummary || '—',
          jiraPriority: row.jiraPriority || '—',
          evidenceFiles: (row.evidenceFiles || []).map((e: any) => ({
            id: e.id,
            filename: e.filename || 'unknown',
            size: e.size || 0,
            createdOn: e.createdOn || null,
            fromStep: e.fromStep || false
          }))
        };
      })
  );

  const noEvidenceRowsJson = serializeRows(filteredRows);
  const withEvidenceRowsJson = serializeRows(data.withEvidenceRows);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>XRAY Test Analytics - ${data.releaseVersion}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;color-scheme:light}
    html{color-scheme:light}
    body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f1f5f9 !important;color:#1e293b !important;padding:2rem;min-height:100vh}
    .container{max-width:1600px;margin:0 auto}
    .header{margin-bottom:3rem;background:linear-gradient(135deg,rgba(6,182,212,.08) 0%,rgba(59,130,246,.08) 100%);padding:2rem;border-radius:20px;border:1px solid rgba(6,182,212,.25)}
    .header-content{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.5rem}
    h1{font-size:2.5rem;background:linear-gradient(135deg,#06b6d4 0%,#3b82f6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:900}
    .header-subtitle{color:#475569 !important;margin-top:.5rem;font-size:1.1rem}
    .total-count{text-align:right}
    .total-count-number{font-size:3rem;font-weight:900;color:#06b6d4 !important}
    .total-count-label{color:#475569 !important;font-size:.9rem;margin-top:.5rem}
    .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1.5rem;margin-bottom:3rem}
    .kpi-card{padding:1.5rem;border-radius:15px;border:1px solid rgba(0,0,0,.1);background:#ffffff !important;box-shadow:0 1px 4px rgba(0,0,0,.08);transition:all .3s ease;position:relative;overflow:hidden;display:flex;flex-direction:column}
    .kpi-label{text-align:center !important}
    .kpi-value{text-align:center !important}
    .kpi-subtext{text-align:center !important}
    .kpi-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#06b6d4,#3b82f6)}
    .kpi-card:hover{transform:translateY(-5px);border-color:rgba(6,182,212,.4);box-shadow:0 4px 12px rgba(6,182,212,.12)}
    .kpi-card.pass{background:#f0fdf4 !important;border-color:rgba(16,185,129,.3)}
    .kpi-card.pass::before{background:#10b981}
    .kpi-card.evidence{background:#eff6ff !important;border-color:rgba(3,105,161,.3)}
    .kpi-card.evidence::before{background:#0369a1}
    .kpi-card.executing{background:#faf5ff !important;border-color:rgba(139,92,246,.3)}
    .kpi-card.executing::before{background:#8b5cf6}
    .kpi-card.pending{background:#fffbeb !important;border-color:rgba(245,158,11,.3)}
    .kpi-card.pending::before{background:#f59e0b}
    .kpi-card.duration{background:#fff5f5 !important;border-color:rgba(239,68,68,.3)}
    .kpi-card.duration::before{background:#ef4444}
    .kpi-card.failed{background:#fff5f5 !important;border-color:rgba(239,68,68,.3)}
    .kpi-card.failed::before{background:#ef4444}
    .kpi-label{color:#475569 !important;font-size:.85rem;font-weight:600;margin-bottom:.8rem;text-transform:uppercase;letter-spacing:1px}
    .kpi-value{font-size:2.5rem;font-weight:900;margin-bottom:.5rem;color:#0f172a !important}
    .kpi-subtext{color:#64748b !important;font-size:.85rem}
    .charts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(500px,1fr));gap:2rem;margin-bottom:3rem}
    .chart-container{background:#ffffff !important;border:1px solid rgba(0,0,0,.1);border-radius:20px;padding:2rem;box-shadow:0 1px 4px rgba(0,0,0,.08);transition:all .3s ease}
    .chart-container:hover{border-color:rgba(6,182,212,.4);box-shadow:0 4px 16px rgba(6,182,212,.1)}
    .chart-title{font-size:1.5rem;font-weight:700;margin-bottom:1.5rem;color:#0284c7 !important}
    .chart-wrapper{position:relative;height:400px}
    .metric-box{background:#f1f5f9 !important;padding:1rem;border-radius:10px;margin:.5rem 0;border-left:3px solid #06b6d4}
    .metric-box.high{border-left-color:#10b981}
    .metric-box.warning{border-left-color:#f59e0b}
    .metric-name{color:#475569 !important;font-size:.9rem;margin-bottom:.3rem}
    .metric-value{font-size:1.8rem;font-weight:900;color:#0284c7 !important}
    .metric-box.high .metric-value{color:#10b981 !important}
    .metric-box.warning .metric-value{color:#f59e0b !important}
    .table-container{background:#ffffff !important;border:1px solid rgba(0,0,0,.1);border-radius:20px;padding:2rem;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow-x:auto;margin-bottom:3rem}
    .table-title{font-size:1.5rem;font-weight:700;margin-bottom:.5rem;color:#0284c7 !important}
    .table-subtitle{color:#475569 !important;font-size:.9rem;margin-bottom:1.5rem}
    table{width:100%;border-collapse:collapse}
    th{background:#f8fafc !important;padding:1rem;text-align:left;color:#475569 !important;font-weight:600;font-size:.9rem;text-transform:uppercase;border-bottom:2px solid rgba(6,182,212,.3)}
    td{padding:1rem;border-bottom:1px solid rgba(0,0,0,.07);color:#1e293b !important;font-size:.9rem}
    tr:hover td{background:rgba(6,182,212,.05) !important}
    tr.zero-dur td{background:rgba(239,68,68,.08) !important;border-top:1px solid rgba(239,68,68,.3);border-bottom:1px solid rgba(239,68,68,.3)}
    .badge{display:inline-block;padding:.3rem .8rem;border-radius:20px;font-size:.8rem;font-weight:600}
    .footer{display:flex;justify-content:space-between;align-items:center;padding-top:2rem;border-top:1px solid rgba(0,0,0,.1);color:#475569 !important;font-size:.9rem;margin-top:3rem}
    .ev-btn{padding:.3rem .8rem;border-radius:8px;border:1px solid rgba(6,182,212,.5);background:rgba(6,182,212,.08);color:#0284c7;cursor:pointer;font-size:.8rem;font-weight:600;white-space:nowrap}
    .ev-btn:hover{background:rgba(6,182,212,.18)}
    #evModal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;align-items:center;justify-content:center}
    #evModal.open{display:flex}
    #evModalBox{background:#fff;border-radius:16px;padding:2rem;max-width:640px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25);position:relative}
    #evModalTitle{font-size:1.1rem;font-weight:700;color:#0f172a;margin-bottom:1.25rem;padding-right:2rem}
    .ev-item{display:flex;align-items:center;gap:1rem;padding:.75rem;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:.6rem;background:#f8fafc}
    .ev-icon{font-size:1.6rem;flex-shrink:0}
    .ev-info{flex:1;min-width:0}
    .ev-name{font-weight:600;color:#0f172a;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ev-meta{font-size:.75rem;color:#94a3b8;margin-top:.2rem}
#evModalClose{position:absolute;top:1rem;right:1rem;background:none;border:none;cursor:pointer;font-size:1.3rem;color:#94a3b8;line-height:1}
    #evModalClose:hover{color:#0f172a}
    .footer-left p,.footer-right p{margin-bottom:.5rem;color:#475569 !important}
    .footer-right{text-align:right}
    @media(max-width:1200px){.charts-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-content">
        <div>
          <h1>XRAY Test Analytics</h1>
          <p class="header-subtitle">${data.releaseVersion} Regression Testing &mdash; Executive Intelligence Dashboard</p>
        </div>
        <div class="total-count">
          <div class="total-count-number">${data.totalExecutions}</div>
          <div class="total-count-label">Total Test Executions</div>
        </div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card pass">
        <div class="kpi-label">Pass Rate</div>
        <div class="kpi-value">${passRate}%</div>
        <div class="kpi-subtext">${passedCount} / ${data.totalTestRuns} passed</div>
      </div>
      <div class="kpi-card evidence">
        <div class="kpi-label">Evidence Coverage (Passed)</div>
        <div class="kpi-value">${evidenceRate}%</div>
        <div class="kpi-subtext">${passedWithEvidence} of ${passedTotal} passed with proof</div>
      </div>
      <div class="kpi-card executing">
        <div class="kpi-label">Executing</div>
        <div class="kpi-value">${executingCount}</div>
        <div class="kpi-subtext">In progress</div>
      </div>
      <div class="kpi-card pending">
        <div class="kpi-label">Pending</div>
        <div class="kpi-value">${todoCount}</div>
        <div class="kpi-subtext">To execute</div>
      </div>
    </div>
    <div class="kpi-grid" style="margin-top:-1rem">
      ${failedCount > 0 ? `
      <div class="kpi-card failed">
        <div class="kpi-label">Failed</div>
        <div class="kpi-value">${failedCount}</div>
        <div class="kpi-subtext">Require attention</div>
      </div>` : `
      <div class="kpi-card" style="border-color:rgba(16,185,129,.2);background:#f0fdf4 !important">
        <div class="kpi-label" style="color:#059669">Failed</div>
        <div class="kpi-value" style="color:#059669">0</div>
        <div class="kpi-subtext">No failures</div>
      </div>`}
      <div class="kpi-card duration">
        <div class="kpi-label">Avg Duration</div>
        <div class="kpi-value">${data.avgDuration.toFixed(1)}m</div>
        <div style="font-size:.75rem;color:#94a3b8;margin-top:.15rem;margin-bottom:.1rem;text-align:center">${(data.avgDuration / 60).toFixed(2)}h</div>
        <div class="kpi-subtext">Per execution</div>
      </div>
      <div class="kpi-card" style="border-color:#f59e0b;background:linear-gradient(135deg,rgba(245,158,11,.07),rgba(245,158,11,.02))">
        <div class="kpi-label" style="color:#b45309">Suspicious — Zero Duration</div>
        <div class="kpi-value" style="color:#d97706">${data.zeroDurationRuns}</div>
        <div class="kpi-subtext">Ran in 0 min — likely not executed</div>
      </div>
      <div class="kpi-card" style="border-color:#f97316;background:linear-gradient(135deg,rgba(249,115,22,.07),rgba(249,115,22,.02))">
        <div class="kpi-label" style="color:#c2410c">Suspicious — Over 8h</div>
        <div class="kpi-value" style="color:#ea580c">${data.longDurationRuns}</div>
        <div class="kpi-subtext">Duration &gt; 8h — possible data issue</div>
      </div>
    </div>
    ${data.emptyExecutions > 0 ? `
    <div style="margin-top:-1.5rem;margin-bottom:2rem;color:#475569;font-size:.85rem;display:flex;align-items:center;gap:.5rem">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#475569"></span>
      <span><strong style="color:#64748b">${data.emptyExecutions}</strong> empty execution${data.emptyExecutions > 1 ? 's' : ''} — no test runs assigned</span>
    </div>` : ''}

    <div class="charts-grid">
      <div class="chart-container">
        <div class="chart-title">Test Status Distribution</div>
        <div class="chart-wrapper"><canvas id="statusChart"></canvas></div>
      </div>
      <div class="chart-container">
        <div class="chart-title">Evidence Coverage — Passed Test Runs</div>
        <div class="chart-wrapper"><canvas id="evidenceChart"></canvas></div>
      </div>
      <div class="chart-container" style="display:none">
        <div class="chart-title">Executor Performance</div>
        <div class="chart-wrapper"><canvas id="executorChart"></canvas></div>
      </div>
      <div class="chart-container">
        <div class="chart-title">Execution Timeline</div>
        <div class="chart-wrapper"><canvas id="timelineChart"></canvas></div>
      </div>
    </div>

    <div class="chart-container" style="display:none;margin-bottom:3rem">
      <div class="chart-title">Execution Duration Statistics</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1rem;margin-top:1rem">
        <div class="metric-box high">
          <div class="metric-name">Maximum Duration</div>
          <div class="metric-value">${data.maxDuration.toFixed(1)}m</div>
        </div>
        <div class="metric-box">
          <div class="metric-name">Average Duration</div>
          <div class="metric-value">${data.avgDuration.toFixed(1)}m</div>
        </div>
        <div class="metric-box warning">
          <div class="metric-name">Minimum Duration</div>
          <div class="metric-value">${data.minDuration.toFixed(1)}m</div>
        </div>
      </div>
    </div>

    <div class="table-container">
      <div style="display:flex;gap:0;margin-bottom:1.5rem;border-bottom:2px solid #e2e8f0">
        <button id="tabNoEvidence" onclick="switchTab('noEvidence')" style="padding:.75rem 1.5rem;border:none;background:none;cursor:pointer;font-size:.95rem;font-weight:600;color:#0284c7;border-bottom:3px solid #0284c7;margin-bottom:-2px;transition:all .2s">
          ✗ Without Evidence &nbsp;<span style="background:#ef444422;color:#ef4444;border-radius:20px;padding:.1rem .6rem;font-size:.8rem">${data.breakdown.passedWithoutEvidence}</span>
        </button>
        <button id="tabWithEvidence" onclick="switchTab('withEvidence')" style="padding:.75rem 1.5rem;border:none;background:none;cursor:pointer;font-size:.95rem;font-weight:600;color:#94a3b8;border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .2s">
          ✓ With Evidence &nbsp;<span style="background:#10b98122;color:#10b981;border-radius:20px;padding:.1rem .6rem;font-size:.8rem">${data.breakdown.passedWithEvidence}</span>
        </button>
        <div style="flex:1;display:flex;justify-content:flex-end;align-items:center;padding-right:.25rem">
          <div id="paginatorTop" style="display:flex;align-items:center;gap:.75rem;font-size:.9rem;color:#94a3b8"></div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Jira Key</th><th>Summary</th><th>Status</th>
            <th>Started</th><th>Finished</th><th>Duration</th>
            <th>Priority</th><th>Comment</th>
            <th id="thEvidence" style="display:none">Evidence</th>
          </tr>
        </thead>
        <tbody id="tableBody"></tbody>
      </table>
      <div id="paginatorBottom" style="display:flex;justify-content:center;align-items:center;gap:.75rem;margin-top:1.5rem;font-size:.9rem;color:#94a3b8"></div>
    </div>

    <div class="footer">
      <div class="footer-left">
        <p>${data.releaseVersion} &mdash; Regression Test Suite</p>
        <p>Generated: ${data.timestamp}</p>
      </div>
      <div class="footer-right">
        <p>Powered by Xray Cloud GraphQL API</p>
        <p>Dashboard v2.0 &mdash; Executive Intelligence Mode</p>
      </div>
    </div>
  </div>

  <div id="evModal">
    <div id="evModalBox">
      <button id="evModalClose" onclick="closeEvidenceModal()">&#x2715;</button>
      <div id="evModalTitle"></div>
      <div id="evModalList"></div>
    </div>
  </div>

  <script>
    const C = {
      cyan:   '#06b6d4',
      green:  '#10b981',
      amber:  '#f59e0b',
      purple: '#8b5cf6',
      red:    '#ef4444',
      blue:   '#3b82f6',
      muted:  'rgba(100,116,139,0.12)',
      tick:   '#64748b',
      bg:     '#ffffff'
    };

    new Chart(document.getElementById('statusChart'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(statusLabels)},
        datasets: [{
          data: ${JSON.stringify(statusData)},
          backgroundColor: ${JSON.stringify(statusBgColors)},
          borderColor: C.bg,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#475569', font: { size: 12 } } } }
      }
    });

    new Chart(document.getElementById('evidenceChart'), {
      type: 'bar',
      data: {
        labels: ['Passed with Evidence', 'Passed without Evidence'],
        datasets: [{
          label: 'Test Runs',
          data: [${passedWithEvidence}, ${passedWithoutEvidence}],
          backgroundColor: [C.cyan, C.red],
          borderColor: [C.cyan, C.red],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { labels: { color: '#475569', font: { size: 12 } } } },
        scales: {
          x: { ticks: { color: C.tick }, grid: { color: C.muted } },
          y: { ticks: { color: C.tick }, grid: { color: C.muted } }
        }
      }
    });

    const executors = ${JSON.stringify(data.executorPerformance)};
    new Chart(document.getElementById('executorChart'), {
      type: 'bar',
      data: {
        labels: executors.map(e => e.name),
        datasets: [
          { label: 'Passed', data: executors.map(e => e.passed), backgroundColor: C.green },
          { label: 'Other',  data: executors.map(e => e.total - e.passed), backgroundColor: C.amber }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { labels: { color: '#475569', font: { size: 12 } } } },
        scales: {
          x: { stacked: true, ticks: { color: C.tick }, grid: { color: C.muted } },
          y: { stacked: true, ticks: { color: C.tick }, grid: { color: C.muted } }
        }
      }
    });

    const dates = ${JSON.stringify(data.dateDistribution)};
    new Chart(document.getElementById('timelineChart'), {
      type: 'line',
      data: {
        labels: dates.map(d => d.date),
        datasets: [{
          label: 'Test Executions',
          data: dates.map(d => d.count),
          borderColor: C.cyan,
          backgroundColor: 'rgba(6,182,212,0.1)',
          borderWidth: 3, fill: true, tension: 0.4,
          pointBackgroundColor: C.cyan, pointBorderColor: C.bg, pointRadius: 5, pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#475569', font: { size: 12 } } } },
        scales: {
          x: { ticks: { color: C.tick }, grid: { color: C.muted } },
          y: { ticks: { color: C.tick }, grid: { color: C.muted } }
        }
      }
    });

    // --- Tabs + Pagination ---
    const JIRA_BASE_URL = '${config.jiraBaseUrl}';
    const datasets = {
      noEvidence:   ${noEvidenceRowsJson},
      withEvidence: ${withEvidenceRowsJson}
    };
    const PAGE_SIZE = 20;
    let activeTab = 'noEvidence';
    const pages = { noEvidence: 1, withEvidence: 1 };

    function switchTab(tab) {
      activeTab = tab;
      const isNo = tab === 'noEvidence';
      document.getElementById('tabNoEvidence').style.color        = isNo ? '#0284c7' : '#94a3b8';
      document.getElementById('tabNoEvidence').style.borderBottom = isNo ? '3px solid #0284c7' : '3px solid transparent';
      document.getElementById('tabWithEvidence').style.color        = isNo ? '#94a3b8' : '#10b981';
      document.getElementById('tabWithEvidence').style.borderBottom = isNo ? '3px solid transparent' : '3px solid #10b981';
      document.getElementById('thEvidence').style.display = isNo ? 'none' : '';
      renderTable();
    }

    function renderTable() {
      const rows = datasets[activeTab];
      const page = pages[activeTab];
      const start = (page - 1) * PAGE_SIZE;
      const pageRows = rows.slice(start, start + PAGE_SIZE);
      const isNoEvidence = activeTab === 'noEvidence';
      const badgeStyle = isNoEvidence
        ? 'background:#10b98122;color:#10b981'
        : 'background:#06b6d422;color:#0284c7';
      document.getElementById('tableBody').innerHTML = pageRows.map((r, i) => {
        const evBtn = (!isNoEvidence && r.evidenceFiles && r.evidenceFiles.length > 0)
          ? \`<button class="ev-btn" onclick="openEvidenceModal(\${start + i})">&#128065; \${r.evidenceFiles.length} file\${r.evidenceFiles.length > 1 ? 's' : ''}</button>\`
          : '';
        return \`
        <tr\${r.zeroDur ? ' class="zero-dur"' : ''}>
          <td><a href="\${JIRA_BASE_URL}/browse/\${r.jiraKey}" target="_blank" style="color:#0284c7;text-decoration:none;font-weight:500">\${r.jiraKey}</a></td>
          <td>\${r.jiraSummary}</td>
          <td><span class="badge" style="\${badgeStyle}">\${r.status}</span></td>
          <td>\${r.startedOn}</td>
          <td>\${r.finishedOn}</td>
          <td>\${r.duration}</td>
          <td>\${r.jiraPriority}</td>
          <td>\${r.comment}</td>
          \${!isNoEvidence ? \`<td>\${evBtn}</td>\` : ''}
        </tr>\`;
      }).join('');
      renderPaginator('paginatorTop');
      renderPaginator('paginatorBottom');
    }

    function btnStyle(disabled) {
      return \`style="padding:.4rem .9rem;border-radius:8px;border:1px solid \${disabled ? 'rgba(148,163,184,.35)' : 'rgba(6,182,212,.5)'};background:\${disabled ? '#f1f5f9' : 'rgba(6,182,212,.08)'};color:\${disabled ? '#94a3b8' : '#0284c7'};cursor:\${disabled ? 'default' : 'pointer'};font-size:.85rem"\`;
    }

    function renderPaginator(id) {
      const rows = datasets[activeTab];
      const page = pages[activeTab];
      const tp = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      document.getElementById(id).innerHTML = \`
        <button \${btnStyle(page === 1)} \${page === 1 ? 'disabled' : ''} onclick="goToPage(\${page - 1})">&#8592; Prev</button>
        <span>Page <strong style="color:#334155">\${page}</strong> of <strong style="color:#334155">\${tp}</strong> &nbsp;·&nbsp; \${rows.length} records</span>
        <button \${btnStyle(page === tp)} \${page === tp ? 'disabled' : ''} onclick="goToPage(\${page + 1})">Next &#8594;</button>
      \`;
    }

    function goToPage(page) {
      const rows = datasets[activeTab];
      const tp = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      if (page < 1 || page > tp) return;
      pages[activeTab] = page;
      renderTable();
      document.querySelector('.table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    renderTable();

    // --- Evidence modal ---
    function fileIcon(filename) {
      const ext = (filename || '').split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return '🖼️';
      if (['mp4','mov','avi','webm'].includes(ext)) return '🎬';
      if (['pdf'].includes(ext)) return '📄';
      if (['zip','rar','7z'].includes(ext)) return '🗜️';
      if (['json','xml','csv','txt','log'].includes(ext)) return '📋';
      return '📎';
    }

    function formatSize(bytes) {
      if (!bytes) return '';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function openEvidenceModal(rowIdx) {
      const row = datasets['withEvidence'][rowIdx];
      const files = row.evidenceFiles || [];
      document.getElementById('evModalTitle').textContent =
        (row.jiraKey !== '—' ? row.jiraKey + ' — ' : '') + row.jiraSummary;
      document.getElementById('evModalList').innerHTML = files.map(f => \`
        <div class="ev-item">
          <span class="ev-icon">\${fileIcon(f.filename)}</span>
          <div class="ev-info">
            <div class="ev-name" title="\${f.filename}">\${f.filename}</div>
            <div class="ev-meta">\${formatSize(f.size)}\${f.fromStep ? ' &nbsp;·&nbsp; from step' : ''}\${f.createdOn ? ' &nbsp;·&nbsp; ' + f.createdOn.slice(0,10) : ''}</div>
          </div>
        </div>
      \`).join('') || '<p style="color:#94a3b8;text-align:center">No evidence files found</p>';
      document.getElementById('evModal').classList.add('open');
    }

    function closeEvidenceModal() {
      document.getElementById('evModal').classList.remove('open');
    }

    document.getElementById('evModal').addEventListener('click', function(e) {
      if (e.target === this) closeEvidenceModal();
    });
  </script>
</body>
</html>`.trim();
}

async function main(): Promise<void> {
  console.log('xray-evidence-analyzer starting...');

  const token = await getXrayToken();
  console.log('Xray auth token obtained successfully.');

  const jql = config.xrayJql.replace('XRAY_VERSION_PLACEHOLDER', config.releaseVersion);
  const executions = await fetchTestExecutions({ authToken: token, jql, limit: 100 });
  console.log(`Fetched ${executions.total} test execution(s) from Xray.`);

  const totalTestRuns = executions.results.reduce((sum, exec) => sum + (exec.testRuns?.total || 0), 0);
  const emptyExecutions = executions.results.filter(exec => (exec.testRuns?.total || 0) === 0).length;
  console.log(`Total test runs across all executions: ${totalTestRuns}`);
  console.log(`Empty executions (no test runs assigned): ${emptyExecutions}`);

  const allTestRuns = executions.results.flatMap(exec => exec.testRuns?.results || []);
  const statusCounts: Record<string, number> = {};
  const breakdown = {
    passedWithEvidence: 0,
    passedWithoutEvidence: 0,
    failedWithEvidence: 0,
    failedWithoutEvidence: 0,
    toDo: 0,
    executing: 0
  };

  const executorMap: Record<string, { total: number; passed: number }> = {};
  const dateMap: Record<string, number> = {};
  let totalDurationMinutes = 0;
  let durationCount = 0;
  let minDuration = Number.POSITIVE_INFINITY;
  let maxDuration = 0;
  let zeroDurationRuns = 0;
  let longDurationRuns = 0;

  allTestRuns.forEach((tr: any) => {
    const status: string = (tr.status?.name || 'Unknown').toUpperCase();
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const hasEvidence = Array.isArray(tr.evidence) && tr.evidence.length > 0;

    if (status === 'PASSED') {
      if (hasEvidence) breakdown.passedWithEvidence += 1;
      else breakdown.passedWithoutEvidence += 1;
    } else if (['FAILED', 'FAIL', 'ERROR', 'BROKEN'].includes(status)) {
      if (hasEvidence) breakdown.failedWithEvidence += 1;
      else breakdown.failedWithoutEvidence += 1;
    } else if (status === 'TO DO' || status === 'TODO') {
      breakdown.toDo += 1;
    } else if (status === 'EXECUTING' || status === 'IN PROGRESS') {
      breakdown.executing += 1;
    }

    const executorKey = tr.executedById || tr.executedBy?.displayName || 'Unknown';
    if (!executorMap[executorKey]) executorMap[executorKey] = { total: 0, passed: 0 };
    executorMap[executorKey].total += 1;
    if (status === 'PASSED') executorMap[executorKey].passed += 1;

    if (tr.startedOn && tr.finishedOn) {
      const started = new Date(tr.startedOn);
      const finished = new Date(tr.finishedOn);
      if (!Number.isNaN(started.getTime()) && !Number.isNaN(finished.getTime()) && finished >= started) {
        const diff = (finished.getTime() - started.getTime()) / 60000;
        totalDurationMinutes += diff;
        durationCount += 1;
        minDuration = Math.min(minDuration, diff);
        maxDuration = Math.max(maxDuration, diff);
        if (diff === 0) zeroDurationRuns += 1;
        if (diff > 480) longDurationRuns += 1;
      }
    }

    if (tr.startedOn) {
      const d = new Date(tr.startedOn);
      if (!Number.isNaN(d.getTime())) {
        const dateKey = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        dateMap[dateKey] = (dateMap[dateKey] || 0) + 1;
      }
    }
  });

  const noEvidenceRows = findNoEvidenceTestRunsInExecutions(executions.results);
  const withEvidenceRows = findWithEvidenceTestRunsInExecutions(executions.results);

  // Combine both sets for a single Jira batch lookup
  const allExecutionKeys = [
    ...noEvidenceRows.filter((r) => (r.status || '').toUpperCase() === 'PASSED').map((r) => r.execution),
    ...withEvidenceRows.map((r) => r.execution)
  ];
  const jiraInfoMap = await fetchJiraIssuesForExecutions(allExecutionKeys);

  const enrichRow = (row: any) => {
    const issueId = row.execution.slice(row.execution.indexOf(':') + 1);
    const jiraInfo = jiraInfoMap.get(issueId);
    return {
      ...row,
      jiraKey: jiraInfo?.key || '—',
      jiraSummary: jiraInfo?.summary || '—',
      jiraPriority: jiraInfo?.priority || '—'
    };
  };

  const noEvidenceRowsEnriched = noEvidenceRows.map(enrichRow);
  const withEvidenceRowsEnriched = withEvidenceRows.map(enrichRow);

  const executorPerformance = Object.entries(executorMap)
    .map(([name, stats]) => ({
      name,
      total: stats.total,
      passed: stats.passed,
      passRate: stats.total ? Number(((stats.passed / stats.total) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const dateDistribution = Object.entries(dateMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const avgDuration = durationCount ? totalDurationMinutes / durationCount : 0;
  const minDurationValue = durationCount === 0 ? 0 : minDuration;
  const maxDurationValue = durationCount === 0 ? 0 : maxDuration;
  console.log(`Found ${noEvidenceRows.length} test run(s) with no evidence.`);
  console.log('Status counts:', statusCounts);
  console.log('Breakdown:', breakdown);

  const recommendation = breakdown.passedWithoutEvidence > breakdown.passedWithEvidence ? 'NO' : 'SI';
  console.log(`Recommendation: ${recommendation}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `recommendation=${recommendation}\n`);
  }

  const passedNoEvidenceRows = noEvidenceRowsEnriched.filter((row) => (row.status || '').toUpperCase() === 'PASSED');
  console.log(`Passed without evidence: ${passedNoEvidenceRows.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputFile = path.join('output', `report-${config.releaseVersion}-${timestamp}.html`);

  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const htmlContent = generateHtmlReport({
    totalExecutions: executions.total,
    emptyExecutions,
    totalTestRuns,
    noEvidenceCount: noEvidenceRowsEnriched.length,
    statusCounts,
    breakdown,
    noEvidenceRows: noEvidenceRowsEnriched,
    withEvidenceRows: withEvidenceRowsEnriched,
    timestamp: new Date().toLocaleString('en-US', { hour12: false }),
    releaseVersion: config.releaseVersion,
    avgDuration,
    maxDuration: maxDurationValue,
    minDuration: minDurationValue,
    zeroDurationRuns,
    longDurationRuns,
    executorPerformance,
    dateDistribution
  });

  fs.writeFileSync(outputFile, htmlContent, 'utf-8');
  console.log(`Generated HTML report at ${outputFile}`);
}

main().catch((err) => {
  console.error('Error running analyzer:', err);
  process.exit(1);
});