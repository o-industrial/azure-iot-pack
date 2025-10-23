import { AzureIoTHubDataConnection } from '../src/sop/AzureIoTHubDataConnection.ts';
import { assertEquals } from './tests.deps.ts';

import './steps/landing-zone/AzureEnsureProvidersStep.test.ts';
import './steps/landing-zone/AzureLandingZoneFoundationStep.test.ts';
import './steps/landing-zone/AzureKeyVaultBootstrapStep.test.ts';
import './steps/landing-zone/AzureLogAnalyticsWorkspaceStep.test.ts';
import './steps/landing-zone/AzureDiagnosticsWiringStep.test.ts';
import './steps/landing-zone/AzureGovernanceAssignmentStep.test.ts';
import './steps/landing-zone/CloudFoundationSOP.test.ts';

Deno.test('Azure IoT pack exports data connection builder', () => {
  assertEquals(typeof AzureIoTHubDataConnection, 'function');
});
