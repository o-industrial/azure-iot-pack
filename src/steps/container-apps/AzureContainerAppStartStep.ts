// deno-lint-ignore-file no-explicit-any
import { Step, StepModuleBuilder, z } from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import { AzureResolveCredentialInputSchema } from '../resolve-credential/AzureResolveCredentialInput.ts';

import { ContainerApp, ContainerAppsAPIClient } from 'npm:@azure/arm-appcontainers@2.2.0';
import { applyDevUserTag } from '../../devUser.ts';

// ---------- Input / Output ----------

export const AzureContainerAppStartInputSchema: z.ZodObject<{
  ResourceGroupName: z.ZodString;
  AppName: z.ZodString;
}> = z.object({
  ResourceGroupName: z.string(),
  AppName: z.string(),
});

export type AzureContainerAppStartInput = z.infer<
  typeof AzureContainerAppStartInputSchema
>;

export const AzureContainerAppStartOutputSchema: z.ZodObject<{
  AppName: z.ZodString;
  Status: z.ZodLiteral<'Started'>;
}> = z.object({
  AppName: z.string(),
  Status: z.literal('Started'),
});

export type AzureContainerAppStartOutput = z.infer<
  typeof AzureContainerAppStartOutputSchema
>;

// ---------- Options ----------

export const AzureContainerAppStartOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
}> = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
});

export type AzureContainerAppStartOptions = z.infer<
  typeof AzureContainerAppStartOptionsSchema
>;

// ---------- Step ----------

type TStepBuilder = StepModuleBuilder<
  AzureContainerAppStartInput,
  AzureContainerAppStartOutput,
  AzureContainerAppStartOptions
>;

export const AzureContainerAppStartStep: TStepBuilder = Step(
  'Azure Container App Start (SDK)',
  'Starts a container app using Azure SDK',
)
  .Input(AzureContainerAppStartInputSchema)
  .Output(AzureContainerAppStartOutputSchema)
  .Options(AzureContainerAppStartOptionsSchema)
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
      // Short-circuit if already started (minReplicas >= 1)
      try {
        const current = await ContainerAppClient.containerApps.get(
          ResourceGroupName,
          AppName,
        );
        const min = Number((current?.template as any)?.scale?.minReplicas ?? 0);
        if (min >= 1) {
          return { AppName, Status: 'Started' };
        }
      } catch (_) {
        // If fetching current state fails (e.g., not found), proceed to start
      }

      // Preferred: call start on the container app
      const ops: any = ContainerAppClient.containerApps as any;
      if (typeof ops.beginStartAndWait === 'function') {
        await ops.beginStartAndWait(ResourceGroupName, AppName);
      } else if (typeof ops.beginStart === 'function') {
        await ops.beginStart(ResourceGroupName, AppName);
      } else {
        // Fallback: set scale to at least 1 via update
        const current = await ContainerAppClient.containerApps.get(
          ResourceGroupName,
          AppName,
        );

        const update: ContainerApp = {
          location: current.location,
          tags: applyDevUserTag(current.tags ?? undefined, current.tags ?? undefined, true),
          managedEnvironmentId: current.managedEnvironmentId,
          configuration: current.configuration,
          template: {
            ...(current.template ?? ({} as any)),
            scale: {
              minReplicas: 1,
              maxReplicas: Math.max(1, (current.template as any)?.scale?.maxReplicas ?? 1),
            } as any,
          } as any,
        };

        await ContainerAppClient.containerApps.beginCreateOrUpdateAndWait(
          ResourceGroupName,
          AppName,
          update,
        );
      }
    } catch (err) {
      throw new Error(`Failed to start container app '${AppName}': ${err}`);
    }

    return { AppName, Status: 'Started' };
  }) as unknown as TStepBuilder;
