# Xray Evidence Analyzer

Tool for analyzing test execution runs in **Xray Cloud** (Jira). It queries the Xray GraphQL API, identifies completed test runs (PASSED/FAILED) that have no attached evidence, and generates a **self-contained interactive HTML report** with metrics, charts, and a paginated data table.

---

## Table of Contents

- [Description](#description)
- [Architecture & Data Flow](#architecture--data-flow)
- [API Call Optimization](#api-call-optimization)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Tool](#running-the-tool)
- [Generated HTML Report](#generated-html-report)
- [CI/CD with GitHub Actions](#cicd-with-github-actions)
- [Environment Variables](#environment-variables)
- [Source Modules](#source-modules)
- [Sample Data Mode](#sample-data-mode)
- [Output](#output)

---

## Description

This project was created to audit **evidence coverage** in test executions managed with Xray (Jira plugin). The main goal is to detect test runs that have been marked as PASSED or FAILED but **have no attached evidence** (screenshots, logs, files), which may represent a quality or compliance issue in the QA process.

**Key metrics produced:**

| Metric | Description |
|--------|-------------|
| Pass Rate | % of test runs with PASSED status |
| Evidence Coverage | % of PASSED test runs that have evidence attached |
| Passed without evidence | Approved tests with no proof attached (critical case) |
| Failed without evidence | Failed tests with no proof attached |
| Pending | Test runs in TO DO status |
| Executing | Test runs currently in EXECUTING status |
| Avg Duration | Average execution time of test runs |
| Executor Performance | Pass rate grouped by executor user |
| Execution Timeline | Distribution of test runs by date |

---

## Architecture & Data Flow

```
┌───────────────────────────────────────────────────────┐
│  START: npm run analyze  (or npm start)               │
└──────────────────────┬────────────────────────────────┘
                       │
              ┌────────▼────────────────────┐
              │  Load .env (config.ts)      │
              │  Read all env variables     │
              └────────┬────────────────────┘
                       │
              ┌────────▼──────────────────────────┐
              │  Xray Cloud Authentication        │
              │  POST /api/v2/authenticate        │
              │  Body: { client_id, client_secret }│
              │  → Bearer Token                   │
              └────────┬──────────────────────────┘
                       │
              ┌────────▼────────────────────────────────────┐
              │  Replace XRAY_VERSION_PLACEHOLDER           │
              │  in XRAY_JQL with RELEASE_VERSION (e.g. r14)│
              └────────┬────────────────────────────────────┘
                       │
              ┌────────▼────────────────────────────────────┐
              │  fetchTestExecutions()                      │
              │  GraphQL POST /api/v2/graphql               │
              │  Auto-pagination (100 items/page)           │
              │  → TestExecutionResult[]                    │
              └────────┬────────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────┐
              │  Data processing & aggregation:           │
              │  - Count statuses (PASSED/FAILED/etc.)    │
              │  - Identify runs without evidence         │
              │  - Calculate duration metrics             │
              │  - Executor performance metrics           │
              │  - Date distribution timeline             │
              └────────┬──────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────┐
              │  generateHtmlReport()                     │
              │  - KPI cards                              │
              │  - Charts (Chart.js v3.9.1)               │
              │  - Paginated data table                   │
              └────────┬──────────────────────────────────┘
                       │
              ┌────────▼────────────────────────────────────────┐
              │  Write output/report-{version}-{timestamp}.html │
              └────────┬────────────────────────────────────────┘
                       │
         [GitHub Actions only] → Email report via Gmail SMTP
```

---

## API Call Optimization

The tool is designed to minimize external API calls. All data is fetched in bulk at startup — the generated HTML report is fully self-contained and requires **zero additional API calls** once rendered in the browser.

### Real example — Release `r13`

| # | Service | Method | Endpoint | Purpose | Result |
|---|---------|--------|----------|---------|--------|
| 1 | Xray | `POST` | `/api/v2/authenticate` | Obtain Bearer token | Token (441 chars) |
| 2 | Xray | `POST` | `/api/v2/graphql` | Fetch executions — page 1 | 100 of 295 executions |
| 3 | Xray | `POST` | `/api/v2/graphql` | Fetch executions — page 2 | 100 of 295 executions |
| 4 | Xray | `POST` | `/api/v2/graphql` | Fetch executions — page 3 | 95 of 295 executions |
| 5 | Jira | `POST` | `/rest/api/3/search/jql` | Enrich issues — batch 1 | 100 of 233 issues |
| 6 | Jira | `POST` | `/rest/api/3/search/jql` | Enrich issues — batch 2 | 100 of 233 issues |
| 7 | Jira | `POST` | `/rest/api/3/search/jql` | Enrich issues — batch 3 | 33 of 233 issues |

**Total: 7 API calls** to generate a complete report for 295 executions and 275 test runs.

### How the optimization works

**Xray — auto-pagination**
GraphQL queries fetch 100 executions per page. The client auto-paginates until all results are retrieved: `ceil(total / 100)` calls.

**Jira — bulk JQL search**
Instead of one REST call per row (which would mean one call per test run), all unique execution IDs are collected, deduplicated, and fetched in a single `id IN (id1, id2, ...)` JQL query, batched at 100 per call.

The 233 unique Jira issues cover both tabs — **Without Evidence (142)** and **With Evidence (58)** — and are fetched in a single combined pass. Many test runs share the same execution ID, so deduplication reduces the call count significantly.

**Comparison vs. naive approach (one call per row):**

| Approach | Xray calls | Jira calls | Total |
|----------|-----------|------------|-------|
| Naive (1 call per row) | 4 | 200+ | **204+** |
| Optimized (bulk) | 4 | 3 | **7** |
| **Reduction** | — | **98%** | **96.6%** |

---

## Project Structure

```
xray-evidence-analyzer/
├── src/
│   ├── index.ts          # Main entry point and HTML report generator
│   ├── config.ts         # Environment variable loader
│   ├── xrayAuth.ts       # Xray Cloud API authentication
│   ├── xrayClient.ts     # GraphQL client with auto-pagination
│   └── filters.ts        # Filtering logic for test runs without evidence
├── dist/                 # Compiled JavaScript (generated by tsc, do not edit)
├── output/               # Generated HTML reports
├── .github/
│   └── workflows/
│       └── xray-report.yml  # GitHub Actions: manual dispatch + email delivery
├── .env                  # Runtime environment variables (do NOT commit)
├── .env.sample           # Environment variables template
├── package.json
├── tsconfig.json
└── README.md
```

---

## Requirements

- **Node.js** >= 18
- **Xray Cloud account** with a valid Client ID and Client Secret
- **Jira project** with test executions managed by Xray

---

## Installation

```bash
git clone <repo-url>
cd xray-evidence-analyzer
npm install
```

---

## Configuration

Copy the sample file and fill in your values:

```bash
cp .env.sample .env
```

Edit `.env` with your credentials. See the full reference in [Environment Variables](#environment-variables).

### .env file — expected values

```env
# ─── Release ────────────────────────────────────────────────────────────────
# The release label used to filter test executions in Jira/Xray.
# This value replaces XRAY_VERSION_PLACEHOLDER inside XRAY_JQL at runtime.
# Format: short release tag (e.g. r14, r15, 2.1.0)
RELEASE_VERSION=r14

# ─── Xray Cloud API ──────────────────────────────────────────────────────────
# Base URL for the Xray Cloud REST/GraphQL API. Usually does not need changing.
XRAY_API_BASE_URL=https://xray.cloud.getxray.app/api/v2

# Client ID obtained from Xray Cloud → API Keys settings page.
# Format: 32-character alphanumeric string (uppercase hex).
# Example: 4BB8963BAE524FBB8D0A2A1D0D0E4678
XRAY_CLIENT_ID=your_client_id_here

# Client Secret paired with the Client ID above.
# Format: 64-character lowercase hex string.
# Example: bdb0fbeb9f17c761725d6b2963ad62c4820bbea91f01d5da1d03b5aa26b092e9
XRAY_CLIENT_SECRET=your_client_secret_here

# ─── JQL Query ───────────────────────────────────────────────────────────────
# Jira Query Language (JQL) used to find the test execution issues to analyze.
# IMPORTANT: Use XRAY_VERSION_PLACEHOLDER as the version label — it will be
# replaced at runtime with the value of RELEASE_VERSION.
# Adjust the project key and labels to match your Jira project.
# Example below targets UAT test executions in project CHCCRM01:
XRAY_JQL=labels = "XRAY_VERSION_PLACEHOLDER" AND labels = "uat" AND project = "CHCCRM01" AND type = "test execution" ORDER BY created DESC

# ─── Output ──────────────────────────────────────────────────────────────────
# Base path for the output file. The actual filename is auto-generated as:
#   report-{RELEASE_VERSION}-{ISO_timestamp}.html
# This value is used as a fallback reference only.
OUTPUT_FILE=output/report.html

# ─── Development / Testing ───────────────────────────────────────────────────
# Set to true to skip real API calls and use mock data instead.
# Useful for testing the report UI without valid credentials.
USE_SAMPLE_DATA=false
```

---

## Running the Tool

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  npm scripts available                                          │
 ├──────────────────┬──────────────────────────────────────────────┤
 │  npm run dev     │  Run directly with ts-node (no build step)   │
 │                  │  → fastest for development & testing         │
 ├──────────────────┼──────────────────────────────────────────────┤
 │  npm run build   │  Compile TypeScript → dist/                  │
 │                  │  → required before npm start                 │
 ├──────────────────┼──────────────────────────────────────────────┤
 │  npm start       │  Run compiled app from dist/                 │
 │                  │  → requires prior npm run build              │
 ├──────────────────┼──────────────────────────────────────────────┤
 │  npm run analyze │  npm run build + npm start in one command    │
 │                  │  → recommended for production use            │
 └──────────────────┴──────────────────────────────────────────────┘
```

### Quick start (recommended)

```bash
# 1. Install dependencies (first time only)
npm install

# 2. Configure environment
cp .env.sample .env
# edit .env with your credentials and RELEASE_VERSION

# 3. Build and run
npm run analyze
```

### Development mode (no build step)

```bash
npm run dev
```

### Run with sample data (no credentials needed)

```bash
# Set USE_SAMPLE_DATA=true in .env, then:
npm run dev
# or
npm run analyze
```

The report is written to `output/report-{RELEASE_VERSION}-{timestamp}.html`.

---

## Generated HTML Report

The report is a **self-contained HTML file** (no server required, opens directly in any browser).

### KPI Cards

KPIs are displayed in two rows of four cards each.

**Row 1 — Execution overview**

| Card | Description |
|------|-------------|
| Pass Rate | % of PASSED test runs out of all completed runs |
| Evidence Coverage | % of PASSED tests that have evidence attached |
| Executing | Test runs currently in EXECUTING status |
| Pending | Test runs in TO DO status |

**Row 2 — Quality signals**

| Card | Description |
|------|-------------|
| Failed | Count of failed runs (shown in green as 0 when no failures) |
| Avg Duration | Average run duration in minutes and hours |
| Suspicious — Zero Duration | Runs that completed in 0 min (likely not actually executed) |
| Suspicious — Over 8h | Runs with duration > 8 hours (possible data quality issue) |

### Charts (Chart.js v3.9.1)

| Chart | Type | Description |
|-------|------|-------------|
| Test Status Distribution | Doughnut | Breakdown of all statuses: PASSED, FAILED, TO DO, EXECUTING |
| Evidence Coverage | Bar | Passed with vs. without evidence + other statuses |
| Executor Performance | Horizontal bar | Pass rate grouped by executor user |
| Execution Timeline | Line | Number of test runs executed per date |

### Paginated Data Table

- Lists all **PASSED test runs without evidence** (the critical case)
- 20 rows per page with navigation controls
- Columns: Execution, TestRun ID, Status, Started, Finished, Duration, Comment
- Rows with 0-minute duration are highlighted in red
- Responsive layout for screens >= 1200px

---

## CI/CD with GitHub Actions

The workflow `.github/workflows/xray-report.yml` generates the report automatically and sends it by email.

### Manual trigger (workflow_dispatch)

Go to **Actions** tab in GitHub → select _Xray Evidence Report_ → **Run workflow** with these inputs:

| Input | Required | Description | Example |
|-------|----------|-------------|---------|
| `release_version` | Yes | Release label to analyze | `r14` |
| `email_to` | No | Email recipients (overrides default secret) | `qa@company.com` |
| `use_sample_data` | No | Use mock data instead of real API | `false` |

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `XRAY_API_BASE_URL` | Xray Cloud API base URL |
| `XRAY_CLIENT_ID` | Xray Cloud Client ID |
| `XRAY_CLIENT_SECRET` | Xray Cloud Client Secret |
| `XRAY_JQL` | JQL query string (with `XRAY_VERSION_PLACEHOLDER`) |
| `GMAIL_USER` | Gmail account used to send the report |
| `GMAIL_APP_PASSWORD` | Gmail app-specific password (not the main account password) |
| `MAIL_TO` | Default email recipient(s) for the report |

### Workflow steps

1. Checkout repository
2. Setup Node.js 20 with npm cache
3. `npm ci` — install dependencies
4. `npm run build` — compile TypeScript
5. `npm start` — generate HTML report
6. Send report as email attachment via Gmail SMTP (`dawidd6/action-send-mail@v3`)

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELEASE_VERSION` | Yes | — | Release label (e.g. `r14`). Replaces `XRAY_VERSION_PLACEHOLDER` in the JQL query. |
| `XRAY_API_BASE_URL` | Yes | `https://xray.cloud.getxray.app/api/v2` | Xray Cloud API base URL |
| `XRAY_CLIENT_ID` | Yes | — | 32-char hex Client ID from Xray Cloud API Keys settings |
| `XRAY_CLIENT_SECRET` | Yes | — | 64-char hex Client Secret paired with the Client ID |
| `XRAY_JQL` | Yes | — | JQL query using `XRAY_VERSION_PLACEHOLDER` as the version marker |
| `OUTPUT_FILE` | No | `output/report.html` | Base output path (actual filename includes version and timestamp) |
| `USE_SAMPLE_DATA` | No | `false` | Set to `true` to skip API calls and use mock data |

---

## Source Modules

### [src/config.ts](src/config.ts)
Loads environment variables via `dotenv` and exports them as a typed config object. Single source of truth for all configuration values across the project.

### [src/xrayAuth.ts](src/xrayAuth.ts)
Handles authentication with Xray Cloud:
- POST to `/api/v2/authenticate` with `client_id` and `client_secret`
- Supports both JSON and plain-text responses
- Returns the Bearer token used for all subsequent API calls

### [src/xrayClient.ts](src/xrayClient.ts)
GraphQL client with automatic pagination:
- `fetchTestExecutions(options)` — fetches all test executions, auto-paginating at PAGE_SIZE = 100
- Returns per execution: `issueId`, `projectId`, `lastModified`, `tests[]`, `testRuns[]`
- Returns per test run: `id`, `status.name`, `startedOn`, `finishedOn`, `executedById`, `comment`, `evidence[]`

### [src/filters.ts](src/filters.ts)
Filtering logic:
- `findNoEvidenceTestRunsInExecutions(executions[])` — filters completed test runs (PASSED/FAILED) with no evidence attached
- Statuses treated as completed: `['PASSED', 'PASS', 'FAILED', 'FAIL']`
- Returns an array of `TestRunNoEvidenceRow` with all fields needed for the report

### [src/index.ts](src/index.ts)
Main orchestrator:
- `main()` — coordinates authentication → fetch → data processing → report generation
- `generateHtmlReport(data)` — builds the full HTML string with embedded CSS, Chart.js scripts and data
- Computes all aggregated metrics: status counts, evidence breakdown, duration stats, executor performance, date timeline

---

## Sample Data Mode

To test the report UI without real credentials:

```env
USE_SAMPLE_DATA=true
```

A mock execution is returned with 1 PASSED test run and no evidence attached, allowing you to verify the report layout and charts work correctly.

---

## Output

```
output/
└── report-r14-2026-03-27T06-50-02.html
```

| Property | Detail |
|----------|--------|
| Filename | `report-{RELEASE_VERSION}-{ISO_timestamp}.html` |
| Size | ~40–60 KB (Chart.js loaded from CDN, styles and data embedded) |
| Self-contained | Opens in any browser with no server or internet connection required (except for Chart.js CDN on first load) |
| Interactive | Table pagination, chart legends, responsive layout |
