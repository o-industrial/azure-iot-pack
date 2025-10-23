import { Step, StepModuleBuilder, z } from '../.deps.ts';
import {
  AzureEnsureProvidersInput,
  AzureEnsureProvidersOutput,
  AzureEnsureProvidersOutputSchema,
  AzureEnsureProvidersStep,
} from '../steps/landing-zone/AzureEnsureProvidersStep.ts';
import {
  AzureLandingZoneFoundationInput,
  AzureLandingZoneFoundationOutput,
  AzureLandingZoneFoundationOutputSchema,
  AzureLandingZoneFoundationStep,
} from '../steps/landing-zone/AzureLandingZoneFoundationStep.ts';
import {
  AzureKeyVaultBootstrapOutput,
  AzureKeyVaultBootstrapOutputSchema,
  AzureKeyVaultBootstrapStep,
} from '../steps/landing-zone/AzureKeyVaultBootstrapStep.ts';
import {
  AzureLogAnalyticsWorkspaceOutput,
  AzureLogAnalyticsWorkspaceOutputSchema,
  AzureLogAnalyticsWorkspaceStep,
} from '../steps/landing-zone/AzureLogAnalyticsWorkspaceStep.ts';
import {
  AzureDiagnosticsWiringInput,
  AzureDiagnosticsWiringOutput,
  AzureDiagnosticsWiringOutputSchema,
  AzureDiagnosticsWiringStep,
} from '../steps/landing-zone/AzureDiagnosticsWiringStep.ts';
import {
  AzureGovernanceAssignmentOutput,
  AzureGovernanceAssignmentOutputSchema,
  AzureGovernanceAssignmentStep,
} from '../steps/landing-zone/AzureGovernanceAssignmentStep.ts';
import { AzureResolveCredentialInputSchema } from '../steps/resolve-credential/AzureResolveCredentialInput.ts';

const ProvidersListSchema = z.array(z.string()).optional();

const ResourceGroupConfigSchema = z.object({
  Name: z.string().optional(),
  Location: z.string(),
  Tags: z.record(z.string()).optional(),
});

const NetworkConfigSchema = z.object({
  Name: z.string(),
  AddressSpace: z.string(),
  Subnets: z.array(
    z.object({
      Name: z.string(),
      AddressPrefix: z.string(),
    }),
  ),
});

const KeyVaultAccessPolicySchema = z.object({
  TenantId: z.string(),
  ObjectId: z.string(),
  Permissions: z.object({
    Keys: z.array(z.string()).optional(),
    Secrets: z.array(z.string()).optional(),
    Certificates: z.array(z.string()).optional(),
    Storage: z.array(z.string()).optional(),
  }),
});

type KeyVaultAccessPolicy = z.infer<typeof KeyVaultAccessPolicySchema>;

const KeyVaultConfigSchema = z.object({
  VaultName: z.string(),
  AccessPolicies: z.array(KeyVaultAccessPolicySchema).optional(),
  Tags: z.record(z.string()).optional(),
});

const LogAnalyticsConfigSchema = z.object({
  WorkspaceName: z.string(),
  RetentionInDays: z.number().optional(),
  Tags: z.record(z.string()).optional(),
});

const DiagnosticsTargetSchema = z.object({
  ResourceId: z.string(),
  Logs: z.array(z.string()).optional(),
  Metrics: z.array(z.string()).optional(),
});

const DiagnosticsConfigSchema = z.object({
  WorkspaceResourceId: z.string().optional(),
  Targets: z.array(DiagnosticsTargetSchema),
});

const GovernancePolicySchema = z.object({
  Id: z.string(),
  Parameters: z.record(z.unknown()).optional(),
});

const GovernanceRoleSchema = z.object({
  RoleDefinitionId: z.string(),
  PrincipalId: z.string(),
  Condition: z.string().optional(),
  ConditionVersion: z.string().optional(),
});

const GovernanceConfigSchema = z.object({
  Scope: z.string(),
  PolicyDefinitions: z.array(GovernancePolicySchema).optional(),
  RoleAssignments: z.array(GovernanceRoleSchema).optional(),
});

type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

export const CloudFoundationSOPInputSchema = z.object({
  WorkspaceLookup: z.string(),
  Providers: ProvidersListSchema,
  ResourceGroup: ResourceGroupConfigSchema,
  Network: NetworkConfigSchema.optional(),
  KeyVault: KeyVaultConfigSchema.optional(),
  LogAnalytics: LogAnalyticsConfigSchema.optional(),
  Diagnostics: DiagnosticsConfigSchema.optional(),
  Governance: GovernanceConfigSchema.optional(),
});

export type CloudFoundationSOPInput = z.infer<typeof CloudFoundationSOPInputSchema>;

export const CloudFoundationSOPOptionsSchema = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
  TenantId: z.string().optional(),
  DefaultProviders: z.array(z.string()).optional(),
  ResourceGroupRoot: z.string().optional(),
  DefaultTags: z.record(z.string()).optional(),
  RetrieveLogAnalyticsSharedKeys: z.boolean().optional(),
});

export type CloudFoundationSOPOptions = z.infer<typeof CloudFoundationSOPOptionsSchema>;

export const CloudFoundationSOPOutputSchema = z.object({
  Providers: AzureEnsureProvidersOutputSchema,
  LandingZone: AzureLandingZoneFoundationOutputSchema,
  KeyVault: AzureKeyVaultBootstrapOutputSchema.optional(),
  LogAnalytics: AzureLogAnalyticsWorkspaceOutputSchema.optional(),
  Diagnostics: AzureDiagnosticsWiringOutputSchema.optional(),
  Governance: AzureGovernanceAssignmentOutputSchema.optional(),
});

export type CloudFoundationSOPOutput = z.infer<typeof CloudFoundationSOPOutputSchema>;

function hasDiagnosticsConfig(
  diagnostics: CloudFoundationSOPInput['Diagnostics'],
): diagnostics is z.infer<typeof DiagnosticsConfigSchema> {
  return Array.isArray(diagnostics?.Targets) && diagnostics.Targets.length > 0;
}

function hasGovernanceConfig(
  governance: CloudFoundationSOPInput['Governance'],
): governance is GovernanceConfig {
  return Boolean(
    governance &&
      ((governance.PolicyDefinitions?.length ?? 0) > 0 ||
        (governance.RoleAssignments?.length ?? 0) > 0),
  );
}

type CloudFoundationStepBuilder = StepModuleBuilder<
  CloudFoundationSOPInput,
  CloudFoundationSOPOutput,
  CloudFoundationSOPOptions
>;

export const CloudFoundationSOP: CloudFoundationStepBuilder = Step(
  'Cloud Foundation SOP',
  'Orchestrates landing zone readiness, baseline resources, and governance hardening for Azure.',
)
  .Input(CloudFoundationSOPInputSchema)
  .Output(CloudFoundationSOPOutputSchema)
  .Options(CloudFoundationSOPOptionsSchema)
  .Steps((_input, ctx) => {
    const {
      SubscriptionID,
      CredentialStrategy,
      DefaultProviders,
      ResourceGroupRoot,
      DefaultTags,
      TenantId,
      RetrieveLogAnalyticsSharedKeys,
    } = ctx.Options!;

    const ensureProvidersOptions = {
      SubscriptionID,
      CredentialStrategy,
      ...(DefaultProviders ? { DefaultProviders } : {}),
    } as Parameters<typeof AzureEnsureProvidersStep.Build>[0];

    const landingZoneOptions = {
      SubscriptionID,
      CredentialStrategy,
      ...(ResourceGroupRoot ? { ResourceGroupRoot } : {}),
      ...(DefaultTags ? { DefaultTags } : {}),
    } as Parameters<typeof AzureLandingZoneFoundationStep.Build>[0];

    const logAnalyticsOptions = {
      SubscriptionID,
      CredentialStrategy,
      ...(RetrieveLogAnalyticsSharedKeys !== undefined
        ? { RetrieveSharedKeys: RetrieveLogAnalyticsSharedKeys }
        : {}),
    } as Parameters<typeof AzureLogAnalyticsWorkspaceStep.Build>[0];

    const steps: Record<string, unknown> = {
      EnsureProviders: AzureEnsureProvidersStep.Build(ensureProvidersOptions),
      LandingZoneFoundation: AzureLandingZoneFoundationStep.Build(landingZoneOptions),
      LogAnalyticsWorkspace: AzureLogAnalyticsWorkspaceStep.Build(logAnalyticsOptions),
      DiagnosticsWiring: AzureDiagnosticsWiringStep.Build({
        SubscriptionID,
        CredentialStrategy,
      }),
      GovernanceAssignment: AzureGovernanceAssignmentStep.Build({
        SubscriptionID,
        CredentialStrategy,
      }),
    };

    if (TenantId) {
      steps.KeyVaultBootstrap = AzureKeyVaultBootstrapStep.Build({
        SubscriptionID,
        CredentialStrategy,
        TenantId,
      });
    }

    // deno-lint-ignore no-explicit-any
    return steps as Record<string, unknown> as any;
  })
  .Run(async (input, ctx) => {
    const stepInvokers = ctx.Steps ?? {};
    const options = ctx.Options!;

    const {
      Providers: providerInput,
      WorkspaceLookup,
      ResourceGroup: resourceGroupInput,
      Network: networkInput,
      LogAnalytics: logAnalyticsInput,
      KeyVault: keyVaultInput,
      Diagnostics: diagnosticsInput,
      Governance: governanceInput,
    } = input;

    const ensureProviders = stepInvokers.EnsureProviders as (
      input: AzureEnsureProvidersInput,
    ) => Promise<AzureEnsureProvidersOutput>;

    const providers = await ensureProviders({
      Providers: providerInput,
    });

    const landingZoneFoundation = stepInvokers.LandingZoneFoundation as (
      input: AzureLandingZoneFoundationInput,
    ) => Promise<AzureLandingZoneFoundationOutput>;

    const landingZone = await landingZoneFoundation({
      WorkspaceLookup,
      ResourceGroup: resourceGroupInput,
      Network: networkInput,
    });

    const resourceGroupName = landingZone.ResourceGroup.Name;
    const resourceGroupLocation = landingZone.ResourceGroup.Location;

    let logAnalytics: AzureLogAnalyticsWorkspaceOutput | undefined;
    if (logAnalyticsInput) {
      const { WorkspaceName, RetentionInDays, Tags } = logAnalyticsInput;
      const logAnalyticsWorkspace = stepInvokers.LogAnalyticsWorkspace as (
        input: {
          WorkspaceName: string;
          Location: string;
          ResourceGroupName: string;
          RetentionInDays?: number;
          Tags?: Record<string, string>;
        },
      ) => Promise<AzureLogAnalyticsWorkspaceOutput>;

      logAnalytics = await logAnalyticsWorkspace({
        WorkspaceName,
        Location: resourceGroupLocation,
        ResourceGroupName: resourceGroupName,
        RetentionInDays,
        Tags,
      });
    }

    let keyVault: AzureKeyVaultBootstrapOutput | undefined;
    if (keyVaultInput) {
      if (!options.TenantId) {
        throw new Error(
          'CloudFoundationSOP requires `TenantId` option when KeyVault configuration is provided.',
        );
      }

      const keyVaultBootstrap = stepInvokers.KeyVaultBootstrap as
        | ((input: {
          VaultName: string;
          Location: string;
          ResourceGroupName: string;
          AccessPolicies?: KeyVaultAccessPolicy[];
          Tags?: Record<string, string>;
        }) => Promise<AzureKeyVaultBootstrapOutput>)
        | undefined;

      if (!keyVaultBootstrap) {
        throw new Error('Key Vault bootstrap step was not configured.');
      }

      keyVault = await keyVaultBootstrap({
        VaultName: keyVaultInput.VaultName,
        Location: resourceGroupLocation,
        ResourceGroupName: resourceGroupName,
        AccessPolicies: keyVaultInput.AccessPolicies,
        Tags: keyVaultInput.Tags,
      });
    }

    let diagnostics: AzureDiagnosticsWiringOutput | undefined;
    if (hasDiagnosticsConfig(diagnosticsInput)) {
      const workspaceResourceId = diagnosticsInput.WorkspaceResourceId ??
        logAnalytics?.WorkspaceId;

      if (!workspaceResourceId) {
        throw new Error(
          'Diagnostics configuration requires a workspace resource ID or an executed Log Analytics step.',
        );
      }

      const diagnosticsWiring = stepInvokers.DiagnosticsWiring as (
        input: AzureDiagnosticsWiringInput,
      ) => Promise<AzureDiagnosticsWiringOutput>;

      diagnostics = await diagnosticsWiring({
        WorkspaceResourceId: workspaceResourceId,
        Targets: diagnosticsInput.Targets,
      });
    }

    let governance: AzureGovernanceAssignmentOutput | undefined;
    if (hasGovernanceConfig(governanceInput)) {
      const governanceAssignment = stepInvokers.GovernanceAssignment as (
        input: GovernanceConfig,
      ) => Promise<AzureGovernanceAssignmentOutput>;

      governance = await governanceAssignment({
        Scope: governanceInput.Scope,
        PolicyDefinitions: governanceInput.PolicyDefinitions,
        RoleAssignments: governanceInput.RoleAssignments,
      });
    }

    return {
      Providers: providers,
      LandingZone: landingZone,
      KeyVault: keyVault,
      LogAnalytics: logAnalytics,
      Diagnostics: diagnostics,
      Governance: governance,
    };
  }) as unknown as CloudFoundationStepBuilder;
