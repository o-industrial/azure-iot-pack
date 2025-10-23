import { assertEquals } from '../../tests.deps.ts';
import { createTestStepContext } from '../_testContext.ts';
import {
  CloudFoundationSOP,
  CloudFoundationSOPInput,
  CloudFoundationSOPOptions,
} from '../../../src/sop/CloudFoundation.ts';
import {
  AzureEnsureProvidersOutput,
} from '../../../src/steps/landing-zone/AzureEnsureProvidersStep.ts';
import {
  AzureLandingZoneFoundationOutput,
} from '../../../src/steps/landing-zone/AzureLandingZoneFoundationStep.ts';
import {
  AzureLogAnalyticsWorkspaceOutput,
} from '../../../src/steps/landing-zone/AzureLogAnalyticsWorkspaceStep.ts';
import {
  AzureKeyVaultBootstrapOutput,
} from '../../../src/steps/landing-zone/AzureKeyVaultBootstrapStep.ts';
import {
  AzureDiagnosticsWiringOutput,
} from '../../../src/steps/landing-zone/AzureDiagnosticsWiringStep.ts';
import {
  AzureGovernanceAssignmentOutput,
} from '../../../src/steps/landing-zone/AzureGovernanceAssignmentStep.ts';
import { AzureResolveCredentialInput } from '../../../src/steps/resolve-credential/AzureResolveCredentialInput.ts';

Deno.test('CloudFoundationSOP orchestrates dependent steps and merges outputs', async () => {
  const credentialStrategy: AzureResolveCredentialInput = {
    Method: 'token',
    Token: 'fake-token',
  };

  const options: CloudFoundationSOPOptions = {
    SubscriptionID: 'sub-id',
    CredentialStrategy: credentialStrategy,
    TenantId: 'tenant-id',
    DefaultProviders: ['Microsoft.Resources'],
    ResourceGroupRoot: 'oi-found',
    DefaultTags: {
      Owner: 'platform',
    },
    RetrieveLogAnalyticsSharedKeys: true,
  };

  const stepModule = CloudFoundationSOP.Build(options);
  const runtime = new stepModule.Step(options);

  const providersOutput: AzureEnsureProvidersOutput = {
    Registered: {
      'Microsoft.Resources': 'Registered',
    },
    Regions: [{ name: 'westus2' }],
  };

  const landingZoneOutput: AzureLandingZoneFoundationOutput = {
    ResourceGroup: {
      Name: 'rg-foundation',
      Id: '/subscriptions/sub-id/resourceGroups/rg-foundation',
      Location: 'westus2',
    },
    Network: {
      Id:
        '/subscriptions/sub-id/resourceGroups/rg-foundation/providers/Microsoft.Network/virtualNetworks/foundation-vnet',
      SubnetIds: {},
    },
  };

  const logAnalyticsOutput: AzureLogAnalyticsWorkspaceOutput = {
    WorkspaceId:
      '/subscriptions/sub-id/resourceGroups/rg-foundation/providers/Microsoft.OperationalInsights/workspaces/oi-law',
    CustomerId: 'customer-id',
    PrimarySharedKey: 'primary-key',
  };

  const keyVaultOutput: AzureKeyVaultBootstrapOutput = {
    VaultId:
      '/subscriptions/sub-id/resourceGroups/rg-foundation/providers/Microsoft.KeyVault/vaults/kv-foundation',
    VaultUri: 'https://kv-foundation.vault.azure.net/',
  };

  const diagnosticsOutput: AzureDiagnosticsWiringOutput = {
    Applied: [{
      ResourceId:
        '/subscriptions/sub-id/resourceGroups/rg-foundation/providers/Microsoft.KeyVault/vaults/kv-foundation',
      SettingName: 'diag-abc123',
    }],
  };

  const governanceOutput: AzureGovernanceAssignmentOutput = {
    PolicyAssignmentIds: ['policy-assignment'],
    RoleAssignmentIds: ['role-assignment'],
  };

  const invocationLog: Record<string, unknown> = {};

  const stepInvokers = {
    EnsureProviders: async (payload: unknown) => {
      invocationLog.EnsureProviders = payload;
      return await Promise.resolve(providersOutput);
    },
    LandingZoneFoundation: async (payload: unknown) => {
      invocationLog.LandingZoneFoundation = payload;
      return await Promise.resolve(landingZoneOutput);
    },
    KeyVaultBootstrap: async (payload: unknown) => {
      invocationLog.KeyVaultBootstrap = payload;
      return await Promise.resolve(keyVaultOutput);
    },
    LogAnalyticsWorkspace: async (payload: unknown) => {
      invocationLog.LogAnalyticsWorkspace = payload;
      return await Promise.resolve(logAnalyticsOutput);
    },
    DiagnosticsWiring: async (payload: unknown) => {
      invocationLog.DiagnosticsWiring = payload;
      return await Promise.resolve(diagnosticsOutput);
    },
    GovernanceAssignment: async (payload: unknown) => {
      invocationLog.GovernanceAssignment = payload;
      return await Promise.resolve(governanceOutput);
    },
  };

  const ctx = createTestStepContext({
    Options: options,
    Steps: stepInvokers as unknown as Record<string, unknown>,
  });

  const input: CloudFoundationSOPInput = {
    WorkspaceLookup: 'workspace',
    Providers: ['Microsoft.Authorization'],
    ResourceGroup: {
      Location: 'westus2',
    },
    KeyVault: {
      VaultName: 'kv-foundation',
    },
    LogAnalytics: {
      WorkspaceName: 'oi-law',
      RetentionInDays: 30,
    },
    Diagnostics: {
      Targets: [{
        ResourceId:
          '/subscriptions/sub-id/resourceGroups/rg-foundation/providers/Microsoft.KeyVault/vaults/kv-foundation',
        Logs: ['AuditEvent'],
        Metrics: ['AllMetrics'],
      }],
    },
    Governance: {
      Scope: '/subscriptions/sub-id',
      PolicyDefinitions: [{
        Id: '/providers/Microsoft.Authorization/policyDefinitions/audit',
      }],
      RoleAssignments: [{
        RoleDefinitionId: '/providers/Microsoft.Authorization/roleDefinitions/reader',
        PrincipalId: '00000000-0000-0000-0000-000000000001',
      }],
    },
  };

  const result = await runtime.Execute(
    input,
    ctx as unknown as Parameters<typeof runtime.Execute>[1],
  );

  assertEquals(result.Providers, providersOutput);
  assertEquals(result.LandingZone, landingZoneOutput);
  assertEquals(result.KeyVault, keyVaultOutput);
  assertEquals(result.LogAnalytics, logAnalyticsOutput);
  assertEquals(result.Diagnostics, diagnosticsOutput);
  assertEquals(result.Governance, governanceOutput);

  assertEquals((invocationLog.EnsureProviders as { Providers?: string[] }).Providers, [
    'Microsoft.Authorization',
  ]);
  assertEquals(
    (invocationLog.LogAnalyticsWorkspace as { Location: string | undefined }).Location,
    'westus2',
  );
  assertEquals(
    (invocationLog.KeyVaultBootstrap as { ResourceGroupName?: string }).ResourceGroupName,
    'rg-foundation',
  );
  assertEquals(
    (invocationLog.DiagnosticsWiring as { WorkspaceResourceId?: string }).WorkspaceResourceId,
    logAnalyticsOutput.WorkspaceId,
  );
  assertEquals(
    (invocationLog.GovernanceAssignment as { Scope: string }).Scope,
    '/subscriptions/sub-id',
  );
});
