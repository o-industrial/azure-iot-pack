// deno-lint-ignore-file no-explicit-any
import { applyDevUserTag, Step, StepModuleBuilder, z } from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import { AzureResolveCredentialInputSchema } from '../resolve-credential/AzureResolveCredentialInput.ts';

import { ContainerApp, ContainerAppsAPIClient } from 'npm:@azure/arm-appcontainers@2.2.0';

// ---------- Input / Output ----------

export const AzureContainerAppStopInputSchema: z.ZodObject<{
  ResourceGroupName: z.ZodString;
  AppName: z.ZodString;
}> = z.object({
  ResourceGroupName: z.string(),
  AppName: z.string(),
});

export type AzureContainerAppStopInput = z.infer<
  typeof AzureContainerAppStopInputSchema
>;

export const AzureContainerAppStopOutputSchema: z.ZodObject<{
  AppName: z.ZodString;
  Status: z.ZodLiteral<'Stopped'>;
}> = z.object({
  AppName: z.string(),
  Status: z.literal('Stopped'),
});

export type AzureContainerAppStopOutput = z.infer<
  typeof AzureContainerAppStopOutputSchema
>;

// ---------- Options ----------

export const AzureContainerAppStopOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
}> = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
});

export type AzureContainerAppStopOptions = z.infer<
  typeof AzureContainerAppStopOptionsSchema
>;

type ReplicaState = 'running' | 'stopped' | 'unknown';

async function resolveContainerAppState(
  client: ContainerAppsAPIClient,
  resourceGroupName: string,
  appName: string,
): Promise<{ current?: ContainerApp; replicaState: ReplicaState }> {
  let current: ContainerApp | undefined;

  try {
    current = await client.containerApps.get(resourceGroupName, appName);
  } catch {
    current = undefined;
  }

  const revisionNames = new Set<string>();
  const props = (current as any)?.properties ?? {};
  const addRevision = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      revisionNames.add(value.trim());
    }
  };

  addRevision(props.latestRevisionName);
  addRevision(props.latestReadyRevisionName);

  if (Array.isArray(props.activeRevisionNames)) {
    for (const value of props.activeRevisionNames) addRevision(value);
  }

  if (revisionNames.size === 0) {
    try {
      for await (
        const revision of client.containerAppsRevisions.listRevisions(
          resourceGroupName,
          appName,
        )
      ) {
        const name = typeof revision.name === 'string'
          ? revision.name
          : ((revision as any)?.name ?? '');
        if (!name) continue;

        const revProps = (revision as any)?.properties ?? {};
        const isActive = revProps.active === true ||
          (Array.isArray(revProps?.trafficWeight) &&
            revProps.trafficWeight.some((t: any) => Number(t?.weight ?? 0) > 0)) ||
          Number(revProps?.replicas ?? revProps?.activeReplicas ?? 0) > 0;

        if (isActive) revisionNames.add(name);
      }
    } catch {
      // Ignore revision listing failures.
    }
  }

  let attemptedReplicaLookup = false;
  let anySuccessfulReplicaLookup = false;

  for (const revisionName of revisionNames) {
    attemptedReplicaLookup = true;

    try {
      const response = await client.containerAppsRevisionReplicas.listReplicas(
        resourceGroupName,
        appName,
        revisionName,
      );

      anySuccessfulReplicaLookup = true;

      const replicas = response?.value ?? [];
      for (const replica of replicas) {
        const status = String((replica as any)?.properties?.status ?? '').toLowerCase();
        if (!status || status === 'running' || status === 'succeeded' || status === 'pending') {
          return { current, replicaState: 'running' };
        }
      }
    } catch {
      // Ignore replica lookup failures.
    }
  }

  if (anySuccessfulReplicaLookup) {
    return { current, replicaState: 'stopped' };
  }

  if (attemptedReplicaLookup) {
    return { current, replicaState: 'unknown' };
  }

  return { current, replicaState: 'unknown' };
}

// ---------- Step ----------

type TStepBuilder = StepModuleBuilder<
  AzureContainerAppStopInput,
  AzureContainerAppStopOutput,
  AzureContainerAppStopOptions
>;

export const AzureContainerAppStopStep: TStepBuilder = Step(
  'Azure Container App Stop (SDK)',
  'Stops a container app using Azure SDK',
)
  .Input(AzureContainerAppStopInputSchema)
  .Output(AzureContainerAppStopOutputSchema)
  .Options(AzureContainerAppStopOptionsSchema)
  .Steps(() => ({
    ResolveCredential: AzureResolveCredentialStep.Build(),
  }))
  .Services((_input, ctx) => {
    const { CredentialStrategy, SubscriptionID } = ctx.Options!;

    const credential = {
      getToken: async () => {
        const { AccessToken } = await ctx.Steps!.ResolveCredential(
          CredentialStrategy,
        );

        return {
          token: AccessToken,
          expiresOnTimestamp: Date.now() + 3600 * 1000,
        };
      },
    };

    const ContainerAppClient = new ContainerAppsAPIClient(
      credential as any,
      SubscriptionID,
    );

    return { ContainerAppClient };
  })
  .Run(async (input, ctx) => {
    const { ResourceGroupName, AppName } = input;
    const { ContainerAppClient } = ctx.Services!;
    try {
      const { current, replicaState } = await resolveContainerAppState(
        ContainerAppClient,
        ResourceGroupName,
        AppName,
      );

      if (replicaState === 'stopped') {
        return { AppName, Status: 'Stopped' };
      }

      // Preferred: call stop on the container app
      const ops: any = ContainerAppClient.containerApps as any;
      if (typeof ops.beginStopAndWait === 'function') {
        await ops.beginStopAndWait(ResourceGroupName, AppName);
      } else if (typeof ops.beginStop === 'function') {
        await ops.beginStop(ResourceGroupName, AppName);
      } else {
        // Fallback: set scale to 0 via update without mutating possibly-undefined nested properties
        const existing = current ?? await ContainerAppClient.containerApps.get(
          ResourceGroupName,
          AppName,
        );

        const update: ContainerApp = {
          location: existing.location,
          tags: applyDevUserTag(existing.tags ?? undefined, existing.tags ?? undefined, true),
          managedEnvironmentId: existing.managedEnvironmentId,
          configuration: existing.configuration,
          template: {
            ...(existing.template ?? ({} as any)),
            // Ensure scale exists and forces zero replicas
            scale: { minReplicas: 0, maxReplicas: 0 } as any,
          } as any,
        };

        await ContainerAppClient.containerApps.beginCreateOrUpdateAndWait(
          ResourceGroupName,
          AppName,
          update,
        );
      }
    } catch (err) {
      // If stopping fails (e.g., app not found), surface a clean error
      throw new Error(`Failed to stop container app '${AppName}': ${err}`);
    }

    return { AppName, Status: 'Stopped' };
  }) as unknown as TStepBuilder;
