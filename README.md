# X-Ray Evidence Analyzer

Analyzes AWS X-Ray traces to find test runs with missing evidence and writes results to CSV.

## Setup

1. `npm install`
2. Copy `.env` and customize AWS values.
3. `npm run analyze`

## Output

- `output/no-evidence-testRuns.csv`

## Environment variables

- `AWS_REGION`
- `OUTPUT_FILE`
- `LOOKBACK_MINUTES`
- `USE_SAMPLE_DATA` (true/false)
