import { assertEquals } from '../../tests.deps.ts';
import { createTestStepContext } from '../_testContext.ts';
import { AzureLogAnalyticsWorkspaceStep } from '../../../src/steps/landing-zone/AzureLogAnalyticsWorkspaceStep.ts';
import { AzureResolveCredentialInput } from '../../../src/steps/resolve-credential/AzureResolveCredentialInput.ts';

Deno.test('AzureLogAnalyticsWorkspaceStep provisions workspace and optionally returns shared key', async () => {
  const stepModule = AzureLogAnalyticsWorkspaceStep.Build();

  const credentialStrategy: AzureResolveCredentialInput = {
    Method: 'token',
    Token: 'fake-token',
  };

  const options = {
    SubscriptionID: 'sub-id',
    CredentialStrategy: credentialStrategy,
    RetrieveSharedKeys: true,
  };

  const runtime = new stepModule.Step(options);

  const workspaceCalls: Array<{
    resourceGroup: string;
    workspaceName: string;
    payload: Record<string, unknown>;
  }> = [];

  const insightsClient = {
    workspaces: {
      beginCreateOrUpdateAndWait: (
        resourceGroup: string,
        workspaceName: string,
        payload: Record<string, unknown>,
      ) => {
        workspaceCalls.push({ resourceGroup, workspaceName, payload });
        return Promise.resolve({
          id:
            `/subscriptions/${options.SubscriptionID}/resourceGroups/${resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/${workspaceName}`,
          customerId: 'customer-id',
        });
      },
    },
    sharedKeysOperations: {
      getSharedKeys: () =>
        Promise.resolve({
          primarySharedKey: 'primary-key',
        }),
    },
  };

  const ctx = createTestStepContext<typeof options, { InsightsClient: typeof insightsClient }>({
    Options: options,
    Services: { InsightsClient: insightsClient },
  });

  const input = {
    WorkspaceName: 'oi-foundation-law',
    Location: 'centralus',
    ResourceGroupName: 'rg-foundation',
    RetentionInDays: 60,
    Tags: {
      Owner: 'platform',
    },
  };

  const result = await runtime.Execute(
    input,
    ctx as unknown as Parameters<typeof runtime.Execute>[1],
  );

  assertEquals(workspaceCalls.length, 1);
  const payload = workspaceCalls[0].payload as {
    retentionInDays?: number;
    tags?: Record<string, string>;
  };

  assertEquals(workspaceCalls[0].resourceGroup, 'rg-foundation');
  assertEquals(workspaceCalls[0].workspaceName, 'oi-foundation-law');
  assertEquals(payload.retentionInDays, 60);
  assertEquals(payload.tags?.Owner, 'platform');

  assertEquals(
    result.WorkspaceId,
    `/subscriptions/${options.SubscriptionID}/resourceGroups/rg-foundation/providers/Microsoft.OperationalInsights/workspaces/oi-foundation-law`,
  );
  assertEquals(result.CustomerId, 'customer-id');
  assertEquals(result.PrimarySharedKey, 'primary-key');
});
