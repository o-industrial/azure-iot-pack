import { Step, StepModuleBuilder, z } from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import { AzureResolveCredentialInputSchema } from '../resolve-credential/AzureResolveCredentialInput.ts';

// ---------- Schema & Types ----------

export const AzureContainerAppJobStatsInputSchema: z.ZodObject<{
  AppName: z.ZodString;
  ResourceGroupName: z.ZodString;
}> = z.object({
  AppName: z.string(),
  ResourceGroupName: z.string(),
});

export type AzureContainerAppJobStatsInput = z.infer<
  typeof AzureContainerAppJobStatsInputSchema
>;

export const AzureContainerAppJobStatsOutputSchema: z.ZodObject<{
  HealthStatus: z.ZodEnum<['Healthy', 'Stale', 'Unreachable']>;
  LastUpdated: z.ZodString;
  Metadata: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}> = z.object({
  HealthStatus: z.enum(['Healthy', 'Stale', 'Unreachable']),
  LastUpdated: z.string(),
  Metadata: z.record(z.unknown()),
});

export type AzureContainerAppJobStatsOutput = z.infer<
  typeof AzureContainerAppJobStatsOutputSchema
>;

// ---------- Options ----------

export const AzureContainerAppJobStatsOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
}> = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
});

export type AzureContainerAppJobStatsOptions = z.infer<
  typeof AzureContainerAppJobStatsOptionsSchema
>;

// ---------- Step Definition ----------

type TStepBuilder = StepModuleBuilder<
  AzureContainerAppJobStatsInput,
  AzureContainerAppJobStatsOutput,
  AzureContainerAppJobStatsOptions
>;

export const AzureContainerAppJobStatsStep: TStepBuilder = Step(
  'Azure Container App Job Stats',
  'Fetches runtime metadata and status for a deployed Container App',
)
  .Input(AzureContainerAppJobStatsInputSchema)
  .Output(AzureContainerAppJobStatsOutputSchema)
  .Options(AzureContainerAppJobStatsOptionsSchema)
  .Steps(() => ({
    ResolveCredential: AzureResolveCredentialStep.Build(),
  }))
  .Run(async (input, ctx) => {
    const { AppName, ResourceGroupName } = input;
    const { SubscriptionID, CredentialStrategy } = ctx.Options!;

    const { AccessToken } = await ctx.Steps!.ResolveCredential(
      CredentialStrategy,
    );

    const url =
      `https://management.azure.com/subscriptions/${SubscriptionID}/resourceGroups/${ResourceGroupName}/providers/Microsoft.App/containerApps/${AppName}?api-version=2023-05-01`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${AccessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      return {
        HealthStatus: 'Unreachable',
        LastUpdated: new Date().toISOString(),
        Metadata: {
          StatusCode: res.status,
          StatusText: res.statusText,
          Error: await res.text(),
        },
      };
    }

    const json = await res.json();
    const revisionStatus = json?.properties?.provisioningState ?? 'Unknown';
    const lastUpdated = json?.systemData?.lastModifiedAt ?? new Date().toISOString();

    const last = new Date(lastUpdated).getTime();
    const now = Date.now();
    const ageMinutes = (now - last) / 60_000;

    const health: 'Healthy' | 'Stale' | 'Unreachable' = ageMinutes > 10
      ? 'Unreachable'
      : ageMinutes > 2
      ? 'Stale'
      : 'Healthy';

    return {
      HealthStatus: health,
      LastUpdated: new Date(last).toISOString(),
      Metadata: {
        Name: json.name,
        Location: json.location,
        Revision: revisionStatus,
        Fqdn: json.properties?.configuration?.ingress?.fqdn,
        ActiveRevisionsMode: json.properties?.configuration?.activeRevisionsMode,
        LastModifiedBy: json.systemData?.lastModifiedBy,
      },
    };
  }) as unknown as TStepBuilder;
