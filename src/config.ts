import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

interface Config {
  outputFile: string;
  useSampleData: boolean;
  xrayApiBaseUrl: string;
  xrayClientId: string;
  xrayClientSecret: string;
  xrayJql: string;
  releaseVersion: string;
  jiraBaseUrl: string;
  jiraAuthToken: string;
}

const config: Config = {
  outputFile: process.env.OUTPUT_FILE || path.join('output', 'report.html'),
  useSampleData: process.env.USE_SAMPLE_DATA === 'true',
  xrayApiBaseUrl: process.env.XRAY_API_BASE_URL || 'https://xray.cloud.getxray.app/api/v2',
  xrayClientId: process.env.XRAY_CLIENT_ID || '',
  xrayClientSecret: process.env.XRAY_CLIENT_SECRET || '',
  xrayJql: process.env.XRAY_JQL || 'labels = "XRAY_VERSION_PLACEHOLDER" AND labels = "uat" AND project = "CHCCRM01" AND type = "test execution" ORDER BY created DESC',
  releaseVersion: process.env.RELEASE_VERSION || 'r12',
  jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://opella-health.atlassian.net',
  jiraAuthToken: process.env.JIRA_AUTH_TOKEN || ''};

export default config;
