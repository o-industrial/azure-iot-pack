import { assertEquals } from '../../tests.deps.ts';
import { createTestStepContext } from '../_testContext.ts';
import { AzureKeyVaultBootstrapStep } from '../../../src/steps/landing-zone/AzureKeyVaultBootstrapStep.ts';
import { AzureResolveCredentialInput } from '../../../src/steps/resolve-credential/AzureResolveCredentialInput.ts';

Deno.test('AzureKeyVaultBootstrapStep applies access policies and returns vault metadata', async () => {
  const stepModule = AzureKeyVaultBootstrapStep.Build();

  const credentialStrategy: AzureResolveCredentialInput = {
    Method: 'token',
    Token: 'fake-token',
  };

  const options = {
    SubscriptionID: 'sub-id',
    CredentialStrategy: credentialStrategy,
    TenantId: 'tenant-id',
  };

  const runtime = new stepModule.Step(options);

  const vaultCalls: Array<{
    resourceGroup: string;
    vaultName: string;
    payload: {
      location: string;
      properties: Record<string, unknown>;
      tags?: Record<string, string>;
    };
  }> = [];

  const keyVaultClient = {
    vaults: {
      beginCreateOrUpdateAndWait: (
        resourceGroup: string,
        vaultName: string,
        payload: {
          location: string;
          properties: Record<string, unknown>;
          tags?: Record<string, string>;
        },
      ) => {
        vaultCalls.push({ resourceGroup, vaultName, payload });
        return Promise.resolve({
          id:
            `/subscriptions/${options.SubscriptionID}/resourceGroups/${resourceGroup}/providers/Microsoft.KeyVault/vaults/${vaultName}`,
          properties: {
            vaultUri: `https://${vaultName}.vault.azure.net/`,
          },
        });
      },
    },
  };

  const ctx = createTestStepContext<typeof options, { KeyVaultClient: typeof keyVaultClient }>({
    Options: options,
    Services: { KeyVaultClient: keyVaultClient },
  });

  const input = {
    VaultName: 'kv-foundation',
    Location: 'eastus',
    ResourceGroupName: 'rg-foundation',
    Tags: {
      Owner: 'platform',
    },
    AccessPolicies: [
      {
        TenantId: 'tenant-id',
        ObjectId: 'object-123',
        Permissions: {
          Keys: ['Get', 'List'],
          Secrets: ['Get'],
        },
      },
    ],
  };

  const result = await runtime.Execute(
    input,
    ctx as unknown as Parameters<typeof runtime.Execute>[1],
  );

  assertEquals(vaultCalls.length, 1);
  const payload = vaultCalls[0].payload;
  assertEquals(vaultCalls[0].resourceGroup, 'rg-foundation');
  assertEquals(vaultCalls[0].vaultName, 'kv-foundation');
  assertEquals(payload.tags?.Owner, 'platform');
  assertEquals(payload.properties.tenantId, options.TenantId);

  const firstPolicy = (payload.properties.accessPolicies as Array<Record<string, unknown>>)[0];
  assertEquals(firstPolicy.tenantId, 'tenant-id');
  assertEquals(firstPolicy.objectId, 'object-123');
  assertEquals(firstPolicy.permissions, {
    keys: ['Get', 'List'],
    secrets: ['Get'],
    certificates: undefined,
    storage: undefined,
  });

  assertEquals(
    result.VaultId,
    `/subscriptions/${options.SubscriptionID}/resourceGroups/rg-foundation/providers/Microsoft.KeyVault/vaults/kv-foundation`,
  );
  assertEquals(result.VaultUri, 'https://kv-foundation.vault.azure.net/');
});
