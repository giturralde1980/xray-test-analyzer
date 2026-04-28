# opella-sf-sfcoe-playground
This repository serves as a dedicated for experimenting with new features, testing code implementations, and exploring innovative ideas without affecting production codebases.

---

# Xray Evidence Analyzer

Tool for analyzing test execution runs in **Xray Cloud** (Jira). It queries the Xray GraphQL API, identifies completed test runs (PASSED/FAILED) classified by evidence coverage, and generates a **self-contained interactive HTML report** with metrics, charts, and a paginated data table. Optionally creates a **Confluence page** with the summary and uploads the report to **Salesforce** as a linked file on an `Evidence__c` record.

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
- [Triggering via API (Postman / Copado)](#triggering-via-api-postman--copado)
- [Environment Variables](#environment-variables)
- [GitHub Secrets](#github-secrets)
- [Source Modules](#source-modules)
- [Sample Data Mode](#sample-data-mode)
- [Output](#output)

---

## Description

This project was created to audit **evidence coverage** in test executions managed with Xray (Jira plugin). The main goal is to detect test runs that have been marked as PASSED but **have no attached evidence** (screenshots, logs, files), which may represent a quality or compliance issue in the QA process.

The tool is **multi-project** — any Jira project within the organization can be analyzed by passing the project key as a parameter. No code changes required.

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
| Suspicious — Zero Duration | Runs completed in 0 min (likely not executed) |
| Suspicious — Over 6h | Runs with duration > 6h (possible data quality issue) |

---

## Architecture & Data Flow

```
┌───────────────────────────────────────────────────────────┐
│  START: npm run analyze  (or GitHub Actions trigger)      │
└──────────────────────┬────────────────────────────────────┘
                       │
              ┌────────▼────────────────────┐
              │  Load .env (config.ts)      │
              │  Read all env variables     │
              └────────┬────────────────────┘
                       │
              ┌────────▼──────────────────────────┐
              │  Xray Cloud Authentication        │
              │  POST /api/v2/authenticate        │
              │  → Bearer Token                   │
              └────────┬──────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────────────┐
              │  Build JQL query                                   │
              │  Replace XRAY_VERSION_PLACEHOLDER → RELEASE_VERSION│
              │  Replace JIRA_PROJECT_PLACEHOLDER → JIRA_PROJECT   │
              └────────┬──────────────────────────────────────────┘
                       │
              ┌────────▼────────────────────────────────────┐
              │  fetchTestExecutions()                      │
              │  GraphQL POST /api/v2/graphql               │
              │  Auto-pagination (100 items/page)           │
              │  → TestExecutionResult[]                    │
              └────────┬────────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────────┐
              │  Fail-fast validation                          │
              │  If total = 0 → exit(1) with clear warning    │
              │  (invalid project key or release version)     │
              └────────┬──────────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────────┐
              │  Data processing & aggregation:               │
              │  - Count statuses (PASSED/FAILED/etc.)        │
              │  - Identify runs with/without evidence        │
              │  - Calculate duration metrics                 │
              │  - Executor performance metrics               │
              │  - Date distribution timeline                 │
              └────────┬──────────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────────┐
              │  Jira REST API enrichment                     │
              │  Bulk JQL fetch — all execution issue IDs     │
              │  → key, summary, priority per issue           │
              └────────┬──────────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────────┐
              │  generateHtmlReport()                         │
              │  - KPI cards (2 rows × 4)                     │
              │  - Charts (Chart.js v3.9.1)                   │
              │  - Two-tab paginated table                    │
              │    · Without Evidence (PASSED, no proof)      │
              │    · With Evidence (evidence files viewer)    │
              └────────┬──────────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────────────────┐
              │  Write output/report-{version}-{timestamp}.html       │
              └────────┬──────────────────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────────┐
              │  [Optional] Create Confluence page            │
              │  Only if CREATE_CONFLUENCE_PAGE=true          │
              │  → Summary table + report attached            │
              └────────┬──────────────────────────────────────┘
                       │
              ┌────────▼──────────────────────────────────────┐
              │  [GitHub Actions only]                        │
              │  Salesforce callback (if generate succeeded)  │
              │  - Create Evidence__c record                  │
              │  - Upload HTML as ContentVersion              │
              │  - Link file to Evidence__c record            │
              └────────────────────────────────────────────────┘
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
Instead of one REST call per row, all unique execution IDs are collected, deduplicated, and fetched in a single `id IN (id1, id2, ...)` JQL query, batched at 100 per call.

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
│   ├── index.ts              # Main orchestrator and HTML report generator
│   ├── config.ts             # Environment variable loader (typed)
│   ├── xrayAuth.ts           # Xray Cloud authentication
│   ├── xrayClient.ts         # GraphQL client with auto-pagination
│   ├── jiraClient.ts         # Jira REST API bulk enrichment
│   ├── confluenceClient.ts   # Confluence page creation (optional)
│   └── filters.ts            # Test run filtering logic
├── dist/                     # Compiled JavaScript (generated by tsc, do not edit)
├── output/                   # Generated HTML reports
├── .github/
│   └── workflows/
│       └── xray-report.yml   # GitHub Actions: manual + API trigger + SF callback
├── .env                      # Runtime environment variables (do NOT commit)
├── package.json
├── tsconfig.json
└── README.md
```

---

## Requirements

- **Node.js** >= 18
- **Xray Cloud account** with a valid Client ID and Client Secret
- **Jira project** with test executions managed by Xray
- *(Optional)* Confluence Cloud access for page creation
- *(Optional)* Salesforce Connected App for Evidence__c upload

---

## Installation

```bash
git clone <repo-url>
cd xray-evidence-analyzer
npm install
```

---

## Configuration

Create a `.env` file at the root with the following variables:

```env
# ─── Xray Cloud API ──────────────────────────────────────────────────────────
XRAY_API_BASE_URL=https://xray.cloud.getxray.app/api/v2
XRAY_CLIENT_ID=your_client_id_here
XRAY_CLIENT_SECRET=your_client_secret_here

# ─── JQL & Filters ───────────────────────────────────────────────────────────
# JIRA_PROJECT_PLACEHOLDER is replaced at runtime with the value of JIRA_PROJECT.
# XRAY_VERSION_PLACEHOLDER is replaced at runtime with the value of RELEASE_VERSION.
XRAY_JQL=labels = "XRAY_VERSION_PLACEHOLDER" AND project = "JIRA_PROJECT_PLACEHOLDER" AND type = "test execution" ORDER BY created DESC

JIRA_PROJECT=CHCCRM01
RELEASE_VERSION=r14

# ─── Jira REST API ───────────────────────────────────────────────────────────
JIRA_BASE_URL=https://your-org.atlassian.net
# Base64 of "email@example.com:api_token"
JIRA_AUTH_TOKEN=your_base64_encoded_email_and_token_here

# ─── Confluence (optional) ───────────────────────────────────────────────────
# Set CREATE_CONFLUENCE_PAGE=true to create a Confluence summary page.
# Authentication reuses JIRA_AUTH_TOKEN (same Atlassian account).
CREATE_CONFLUENCE_PAGE=false
CONFLUENCE_SPACE_KEY=MYSPACE
CONFLUENCE_PARENT_PAGE_ID=123456789

# ─── Salesforce (GitHub Actions only) ────────────────────────────────────────
SF_INSTANCE_URL=https://yourorg.my.salesforce.com
SF_CLIENT_ID=your_connected_app_consumer_key
SF_CLIENT_SECRET=your_connected_app_consumer_secret

# ─── Development / Testing ───────────────────────────────────────────────────
USE_SAMPLE_DATA=false
OUTPUT_FILE=output/report.html
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
 ├──────────────────┼──────────────────────────────────────────────┤
 │  npm start       │  Run compiled app from dist/                 │
 ├──────────────────┼──────────────────────────────────────────────┤
 │  npm run analyze │  npm run build + npm start in one command    │
 │                  │  → recommended for production use            │
 └──────────────────┴──────────────────────────────────────────────┘
```

### Quick start

```bash
npm install
cp .env.sample .env   # fill in your values
npm run analyze
```

### Development mode (no build step)

```bash
npm run dev
```

The report is written to `output/report-{RELEASE_VERSION}-{timestamp}.html`.

---

## Generated HTML Report

The report is a **self-contained HTML file** (no server required, opens directly in any browser).

### KPI Cards

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
| Suspicious — Zero Duration | Runs completed in 0 min (likely not actually executed) |
| Suspicious — Over 6h | Runs with duration > 6 hours (possible data quality issue) |

### Charts (Chart.js v3.9.1)

| Chart | Type | Description |
|-------|------|-------------|
| Test Status Distribution | Doughnut | Breakdown of all statuses |
| Evidence Coverage | Horizontal bar | Passed with vs. without evidence |
| Execution Timeline | Line | Number of test runs executed per date |

### Two-Tab Data Table

| Tab | Contents |
|-----|----------|
| Without Evidence | PASSED test runs with no evidence attached — the critical case |
| With Evidence | PASSED test runs with evidence files — includes file viewer modal |

- 20 rows per page with navigation controls
- Columns: Jira Key (linked), Summary, Status, Started, Finished, Duration, Priority, Comment
- Rows with 0-minute duration highlighted in red
- Evidence files modal shows filename, size, date, and type icon

---

## CI/CD with GitHub Actions

The workflow `.github/workflows/xray-report.yml` supports both manual and API-based triggering, with an optional Salesforce callback on success.

### Workflow steps

1. Checkout repository
2. Setup Node.js 20 with npm cache
3. `npm ci` — install dependencies
4. `npm run build` — compile TypeScript
5. `npm start` — generate HTML report (exits with code 1 if project/release not found)
6. *(if generate succeeded)* Salesforce callback — create `Evidence__c` record and upload HTML report

### Manual trigger (workflow_dispatch)

Go to **Actions** tab in GitHub → select _XRAY Evidence Report_ → **Run workflow**:

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `release_version` | Yes | `r14` | Release label to analyze (e.g. `r13`, `r14`) |
| `use_sample_data` | No | `false` | Use mock data instead of real API |
| `jira_project` | No | `CHCCRM01` | Jira project key to filter |
| `create_confluence_page` | No | `false` | Create a Confluence summary page |
| `confluence_space_key` | No | *(from secret)* | Confluence space key (overrides secret) |
| `confluence_parent_page_id` | No | *(from secret)* | Confluence parent page ID (overrides secret) |
| `create_salesforce_object` | No | `false` | Create an Evidence__c record in Salesforce and upload the HTML report |

---

## Triggering via API (Postman / Copado)

Send a `POST` request to the GitHub API:

```
POST https://api.github.com/repos/{owner}/{repo}/dispatches
Authorization: Bearer <GITHUB_PAT>
Content-Type: application/json
```

### Minimal payload (no Confluence, default project)

```json
{
  "event_type": "xray-report",
  "client_payload": {
    "release_version": "r14",
    "use_sample_data": "false"
  }
}
```

### Full payload (all parameters explicit)

```json
{
  "event_type": "xray-report",
  "client_payload": {
    "release_version": "r14",
    "email_to": "test@test.com",
    "use_sample_data": "false",
    "jira_project": "CHCCRM01",
    "create_confluence_page": "false",
    "confluence_space_key": "DIGITALCOM",
    "confluence_parent_page_id": "1435632353",
    "create_salesforce_object": "false"
  }
}
```

### With Confluence page creation

```json
{
  "event_type": "xray-report",
  "client_payload": {
    "release_version": "r14",
    "use_sample_data": "false",
    "jira_project": "CHCCRM01",
    "create_confluence_page": "true",
    "confluence_space_key": "DIGITALCOM",
    "confluence_parent_page_id": "1435632353"
  }
}
```

### Parameter priority (for jira_project, confluence_*)

```
Manual input (workflow_dispatch) → client_payload → GitHub Secret → code default
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELEASE_VERSION` | Yes | — | Release label (e.g. `r14`). Replaces `XRAY_VERSION_PLACEHOLDER` in the JQL. |
| `JIRA_PROJECT` | No | `CHCCRM01` | Jira project key. Replaces `JIRA_PROJECT_PLACEHOLDER` in the JQL. |
| `XRAY_API_BASE_URL` | No | `https://xray.cloud.getxray.app/api/v2` | Xray Cloud API base URL |
| `XRAY_CLIENT_ID` | Yes | — | 32-char hex Client ID from Xray Cloud API Keys |
| `XRAY_CLIENT_SECRET` | Yes | — | 64-char hex Client Secret |
| `XRAY_JQL` | No | *(built-in template)* | JQL with `XRAY_VERSION_PLACEHOLDER` and `JIRA_PROJECT_PLACEHOLDER` |
| `JIRA_BASE_URL` | Yes | `https://opella-health.atlassian.net` | Jira instance base URL |
| `JIRA_AUTH_TOKEN` | Yes | — | Base64 of `email@example.com:api_token` |
| `CREATE_CONFLUENCE_PAGE` | No | `false` | Set to `true` to create a Confluence page |
| `CONFLUENCE_SPACE_KEY` | No | — | Confluence space key (required if `CREATE_CONFLUENCE_PAGE=true`) |
| `CONFLUENCE_PARENT_PAGE_ID` | No | — | ID of the parent page in Confluence |
| `SF_INSTANCE_URL` | No | — | Salesforce instance URL (GitHub Actions only) |
| `SF_CLIENT_ID` | No | — | Salesforce Connected App consumer key |
| `SF_CLIENT_SECRET` | No | — | Salesforce Connected App consumer secret |
| `OUTPUT_FILE` | No | `output/report.html` | Base output path |
| `USE_SAMPLE_DATA` | No | `false` | Set to `true` to skip API calls and use mock data |

---

## GitHub Secrets

| Secret | Description |
|--------|-------------|
| `XRAY_API_BASE_URL` | Xray Cloud API base URL |
| `XRAY_CLIENT_ID` | Xray Cloud Client ID |
| `XRAY_CLIENT_SECRET` | Xray Cloud Client Secret |
| `JIRA_BASE_URL` | Jira Cloud instance base URL |
| `JIRA_AUTH_TOKEN` | Base64 of `email:api_token` for Jira REST API |
| `CONFLUENCE_SPACE_KEY` | Default Confluence space key |
| `CONFLUENCE_PARENT_PAGE_ID` | Default Confluence parent page ID |
| `SF_CLIENT_ID` | Salesforce Connected App consumer key |
| `SF_CLIENT_SECRET` | Salesforce Connected App consumer secret |
| `SF_INSTANCE_URL` | Salesforce instance URL |

---

## Source Modules

### [src/config.ts](src/config.ts)
Loads environment variables via `dotenv` and exports a typed config object. Single source of truth for all configuration across the project. Key fields: `releaseVersion`, `jiraProject`, `createConfluencePage`, `confluenceSpaceKey`, `confluenceParentPageId`.

### [src/xrayAuth.ts](src/xrayAuth.ts)
Handles authentication with Xray Cloud. POSTs to `/api/v2/authenticate` and returns the Bearer token used for all subsequent GraphQL calls.

### [src/xrayClient.ts](src/xrayClient.ts)
GraphQL client with automatic pagination (PAGE_SIZE = 100). Returns per test run: `id`, `status.name`, `startedOn`, `finishedOn`, `executedById`, `comment`, `evidence[]`, `steps[].evidence[]`.

### [src/jiraClient.ts](src/jiraClient.ts)
Jira REST API v3 client. Enriches test run rows with Jira issue data (key, summary, priority) using bulk JQL queries batched at 100 IDs per call to minimize API usage.

### [src/confluenceClient.ts](src/confluenceClient.ts)
Creates a Confluence page under the configured parent page. Only called when `CREATE_CONFLUENCE_PAGE=true`. Generates: KPI panels (pass rate, evidence coverage, failed, executing, pending), status donut chart, evidence bar chart, additional metrics table (avg duration, zero duration, over 6h), and three expand sections (zero duration runs, over 6h runs, passed without evidence). Empty executions note shown when applicable. Attaches SVG charts and the full HTML report. Authentication reuses `JIRA_AUTH_TOKEN` (same Atlassian account).

### [src/filters.ts](src/filters.ts)
Filtering logic:
- `findNoEvidenceTestRunsInExecutions()` — PASSED/FAILED runs with no evidence attached
- `findWithEvidenceTestRunsInExecutions()` — PASSED runs with at least one evidence file

### [src/index.ts](src/index.ts)
Main orchestrator. Coordinates: auth → fetch → validation → processing → Jira enrichment → HTML generation → file write → optional Confluence page. Also writes `recommendation` and `confluence_url` to `$GITHUB_OUTPUT` for downstream steps.

---

## Sample Data Mode

To test the report UI without real credentials:

```env
USE_SAMPLE_DATA=true
```

A mock execution is returned with 1 PASSED test run and no evidence attached, allowing you to verify the report layout and charts without API access.

---

## Output

```
output/
└── report-r14-2026-04-23T10-30-00.html
```

| Property | Detail |
|----------|--------|
| Filename | `report-{RELEASE_VERSION}-{ISO_timestamp}.html` |
| Size | ~40–60 KB (Chart.js loaded from CDN, styles and data embedded) |
| Self-contained | Opens in any browser with no server required |
| Interactive | Two-tab table, pagination, evidence file modal, chart legends |

---

## Pending Improvements

Items identified during development that require a business or technical decision before implementation. Documented here for the team taking over the project.

---

### 1. Test Execution Filtering Strategy: `labels` vs `fixVersion`

**Current state:** Test executions are retrieved using a `labels`-based JQL query (e.g. `labels = "r15"`). This works, but labels are free-text fields — any team member can add or omit them inconsistently.

**The problem:** Jira also has a structured `fixVersion` field (e.g. `r15.0.0`) that is more reliable and links directly to the release. However, not all past releases used `fixVersion` consistently (e.g. r14 did not use it), which makes a simple switch risky.

**What needs to be decided:**
- Going forward, will all test executions be tagged with `fixVersion`? If yes, what is the exact format? (e.g. `r15.0.0`, `r15.1.0`)
- Should the filter combine both fields? e.g. `fixVersion = "r15.0.0" AND labels = "UAT"`
- Is the `UAT` label required to exclude SIT executions, or is there another way to differentiate them?

**Impact:** Once the team defines the convention, the change in code is minimal (two lines in `src/config.ts` and `RELEASE_VERSION` format in `.env`). The important thing is that the convention is documented and followed consistently from that release forward.

---

### 2. "Not Applicable" Test Status

**Current state:** Xray has a status called `NOT_APPLICABLE` (or similar) for tests that do not apply to a given release or country. Currently this status is not handled explicitly — testers sometimes mark these tests as PASSED without attaching evidence, since the test simply does not apply.

**The problem:** These runs pollute the _Passed Without Evidence_ metrics, making the evidence coverage look worse than it actually is and generating noise in the report.

**What needs to be decided:**
- Should `NOT_APPLICABLE` runs be excluded entirely from the report?
- Or displayed in a separate section/tab so they are visible but not counted as a quality issue?
- Is the team going to enforce a proper `NOT_APPLICABLE` status in Xray, or will they keep using PASSED for these cases?

**Impact:** Requires adding `NOT_APPLICABLE` (or equivalent) to the status handling in `src/index.ts` and updating the filter logic in `src/filters.ts`. Small change once the decision is made.

---

### 3. Country Field on Test Runs

**Current state:** The report does not include a country dimension. All test executions and runs are treated the same regardless of geography.

**The problem:** The organization tests across multiple countries, and some tests only apply to specific regions. Without a country field, it is impossible to filter or break down results by country in the report.

**What needs to be decided:**
- Is `country` a custom field in Xray or in the Jira issue?
- What is the exact field name/ID in the Xray GraphQL schema or Jira REST API?
- Should the report show a country breakdown chart or just a column in the table?

**Impact:** Requires adding the country field to the GraphQL query in `src/xrayClient.ts` and to the Jira enrichment in `src/jiraClient.ts`, then surfacing it in the HTML report.

---

### 4. Test Criticality / Priority

**Current state:** The report shows the Jira issue `priority` field (e.g. _Medium_, _High_) as a column in the data table. In practice, most issues are set to _Medium_ by default and the field is never updated, making it meaningless.

**The problem:** Without a meaningful criticality signal, it is impossible to prioritize which passed-without-evidence runs are most urgent to fix.

**What needs to be decided:**
- Will the team define and maintain a proper priority or criticality field in Jira/Xray?
- Is there a custom Xray field (e.g. test importance or risk level) that should be used instead of the standard Jira priority?
- Should the report highlight or sort by criticality once it is meaningful?

**Impact:** If a custom field is used, `src/jiraClient.ts` needs to include it in the fields list and the HTML report needs a new column or sort option.

---

### 5. Technical Debt

| # | Item | Detail |
|---|------|--------|
| T1 | Confluence SVG re-upload | When updating an existing Confluence page, SVG chart attachments fail with HTTP 400 if a file with the same name already exists. The fix requires deleting or versioning the attachment before re-uploading. |
| T2 | Missing `.env.sample` | The README installation guide references `cp .env.sample .env` but the file does not exist in the repository. A sanitized sample file should be added so new contributors can onboard without reading the full README. |
