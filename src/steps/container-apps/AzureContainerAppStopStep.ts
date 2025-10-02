// deno-lint-ignore-file no-explicit-any
import { Step, StepModuleBuilder, z } from '../../.deps.ts';
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
      // Short-circuit if already stopped (minReplicas === 0)
      try {
        const current = await ContainerAppClient.containerApps.get(
          ResourceGroupName,
          AppName,
        );
        const min = Number((current?.template as any)?.scale?.minReplicas ?? 0);
        if (!min || min === 0) {
          return { AppName, Status: 'Stopped' };
        }
      } catch (_) {
        // If fetching current state fails (e.g., not found), proceed to stop
      }

      // Preferred: call stop on the container app
      const ops: any = ContainerAppClient.containerApps as any;
      if (typeof ops.beginStopAndWait === 'function') {
        await ops.beginStopAndWait(ResourceGroupName, AppName);
      } else if (typeof ops.beginStop === 'function') {
        await ops.beginStop(ResourceGroupName, AppName);
      } else {
        // Fallback: set scale to 0 via update without mutating possibly-undefined nested properties
        const current = await ContainerAppClient.containerApps.get(
          ResourceGroupName,
          AppName,
        );

        const update: ContainerApp = {
          location: current.location,
          tags: current.tags,
          managedEnvironmentId: current.managedEnvironmentId,
          configuration: current.configuration,
          template: {
            ...(current.template ?? ({} as any)),
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
