import { assertEquals } from '../../tests.deps.ts';
import { createTestStepContext } from '../_testContext.ts';
import { shaHash } from '../../../src/.deps.ts';
import { AzureDiagnosticsWiringStep } from '../../../src/steps/landing-zone/AzureDiagnosticsWiringStep.ts';
import { AzureResolveCredentialInput } from '../../../src/steps/resolve-credential/AzureResolveCredentialInput.ts';

Deno.test('AzureDiagnosticsWiringStep wires diagnostics using deterministic setting names', async () => {
  const stepModule = AzureDiagnosticsWiringStep.Build();

  const credentialStrategy: AzureResolveCredentialInput = {
    Method: 'token',
    Token: 'fake-token',
  };

  const options = {
    SubscriptionID: 'sub-id',
    CredentialStrategy: credentialStrategy,
  };

  const runtime = new stepModule.Step(options);

  const diagnosticCalls: Array<{
    resourceId: string;
    settingName: string;
    payload: Record<string, unknown>;
  }> = [];

  const monitorClient = {
    diagnosticSettings: {
      createOrUpdate: (
        resourceId: string,
        settingName: string,
        payload: Record<string, unknown>,
      ) => {
        diagnosticCalls.push({ resourceId, settingName, payload });
        return Promise.resolve({});
      },
    },
  };

  const ctx = createTestStepContext<typeof options, { MonitorClient: typeof monitorClient }>({
    Options: options,
    Services: { MonitorClient: monitorClient },
  });

  const targetResource =
    '/subscriptions/sub-id/resourceGroups/rg/providers/Microsoft.Web/sites/app';
  const logs = ['AppServiceHTTPLogs', 'AppServiceConsoleLogs'];
  const metrics = ['AllMetrics'];

  const input = {
    WorkspaceResourceId:
      '/subscriptions/sub-id/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/law',
    Targets: [
      {
        ResourceId: targetResource,
        Logs: logs,
        Metrics: metrics,
      },
    ],
  };

  const result = await runtime.Execute(
    input,
    ctx as unknown as Parameters<typeof runtime.Execute>[1],
  );

  assertEquals(result.Applied.length, 1);
  const applied = result.Applied[0];

  const expectedHash = await shaHash(targetResource, 'diag');
  const expectedSettingName = `diag-${expectedHash.substring(0, 12)}`;

  assertEquals(applied.ResourceId, targetResource);
  assertEquals(applied.SettingName, expectedSettingName);

  assertEquals(diagnosticCalls.length, 1);
  const payload = diagnosticCalls[0].payload as {
    logs?: Array<{ category: string; enabled: boolean }>;
    metrics?: Array<{ category: string; enabled: boolean }>;
  };

  assertEquals(diagnosticCalls[0].settingName, expectedSettingName);
  assertEquals(payload.logs?.map((entry) => entry.category), logs);
  assertEquals(payload.metrics?.map((entry) => entry.category), metrics);
  assertEquals(
    payload.logs?.every((entry) => entry.enabled === true),
    true,
  );
  assertEquals(
    payload.metrics?.every((entry) => entry.enabled === true),
    true,
  );
});
