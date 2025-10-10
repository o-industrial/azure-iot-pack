// deno-lint-ignore-file no-explicit-any
import { Step, StepModuleBuilder, withDevUserTag, z } from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import { AzureResolveCredentialInputSchema } from '../resolve-credential/AzureResolveCredentialInput.ts';

import {
  ContainerApp,
  ContainerAppsAPIClient,
  ManagedEnvironment,
} from 'npm:@azure/arm-appcontainers@2.2.0';

// ---------- Input / Output ----------

export const AzureContainerAppJobDeployInputSchema: z.ZodObject<{
  AppEnvironmentName: z.ZodString;
  AppName: z.ZodString;
  Image: z.ZodString;
  EnvironmentVariables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  ResourceGroupName: z.ZodString;
  AppEnvironmentTags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  AppTags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}> = z.object({
  AppEnvironmentName: z.string(),
  AppName: z.string(),
  Image: z.string(),
  EnvironmentVariables: z.record(z.string()).optional(),
  ResourceGroupName: z.string(),
  AppEnvironmentTags: z.record(z.string()).optional(),
  AppTags: z.record(z.string()).optional(),
});

export type AzureContainerAppJobDeployInput = z.infer<
  typeof AzureContainerAppJobDeployInputSchema
>;

export const AzureContainerAppJobDeployOutputSchema: z.ZodObject<{
  AppName: z.ZodString;
  Status: z.ZodLiteral<'Deployed'>;
  DeploymentResult: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}> = z.object({
  AppName: z.string(),
  Status: z.literal('Deployed'),
  DeploymentResult: z.record(z.unknown()),
});

export type AzureContainerAppJobDeployOutput = z.infer<
  typeof AzureContainerAppJobDeployOutputSchema
>;

// ---------- Options ----------

export const AzureContainerAppJobDeployOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
}> = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
});

export type AzureContainerAppJobDeployOptions = z.infer<
  typeof AzureContainerAppJobDeployOptionsSchema
>;

// ---------- Step ----------

type TStepBuilder = StepModuleBuilder<
  AzureContainerAppJobDeployInput,
  AzureContainerAppJobDeployOutput,
  AzureContainerAppJobDeployOptions
>;

export const AzureContainerAppJobDeployStep: TStepBuilder = Step(
  'Azure Container App Job Deploy (SDK)',
  'Deploys a container app job using Azure SDK',
)
  .Input(AzureContainerAppJobDeployInputSchema)
  .Output(AzureContainerAppJobDeployOutputSchema)
  .Options(AzureContainerAppJobDeployOptionsSchema)
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
    const {
      AppEnvironmentName,
      AppName,
      Image,
      EnvironmentVariables,
      ResourceGroupName,
      AppEnvironmentTags,
      AppTags,
    } = input;

    const { SubscriptionID } = ctx.Options!;
    const { ContainerAppClient } = ctx.Services!;
    const location = 'westus2';
    const environmentTags = withDevUserTag(AppEnvironmentTags);
    const appTags = withDevUserTag(AppTags);

    // --- Ensure Managed Environment ---
    try {
      await ContainerAppClient.managedEnvironments.get(
        ResourceGroupName,
        AppEnvironmentName,
      );
    } catch (err: any) {
      if (err.statusCode === 404) {
        await ContainerAppClient.managedEnvironments.beginCreateOrUpdateAndWait(
          ResourceGroupName,
          AppEnvironmentName,
          {
            location,
            appLogsConfiguration: {},
            zoneRedundant: false,
            workloadProfiles: [
              {
                name: 'Consumption',
                workloadProfileType: 'Consumption',
              },
            ],
            tags: environmentTags,
            // properties: {
            //   // appLogsConfiguration: {
            //   //   // destination: 'log-analytics',
            //   //   // logAnalyticsConfiguration: {
            //   //   //   customerId:
            //   //   //     "[reference(parameters('workspaceId'), '2020-08-01').customerId]",
            //   //   //   sharedKey:
            //   //   //     "[listKeys(parameters('workspaceId'), '2020-08-01').primarySharedKey]",
            //   //   // },
            //   //   destination: null,
            //   //   logAnalyticsConfiguration: null,
            //   // },
            //   // zoneRedundancyEnabled: false,
            //   // vnetConfiguration: {
            //   //   infrastructureSubnetId: null,
            //   // },
            //   // publicNetworkAccess: 'Enabled',
            //   // workloadProfiles: [
            //   //   {
            //   //     name: 'Consumption',
            //   //     workloadProfileType: 'Consumption',
            //   //   },
            //   // ],
            // },
          } as ManagedEnvironment,
        );
      } else {
        throw new Error(
          `Failed to check or create managed environment: ${err.message}`,
        );
      }
    }

    // --- Deploy Container App ---
    const containerApp: ContainerApp = {
      location,
      tags: appTags,
      managedEnvironmentId:
        `/subscriptions/${SubscriptionID}/resourceGroups/${ResourceGroupName}/providers/Microsoft.App/managedEnvironments/${AppEnvironmentName}`,
      configuration: {
        activeRevisionsMode: 'Single',
      },
      template: {
        containers: [
          {
            name: AppName,
            image: Image,
            env: Object.entries(EnvironmentVariables ?? {}).map(
              ([name, value]) => ({
                name,
                value,
              }),
            ),
            resources: {
              cpu: 0.25,
              memory: '0.5Gi',
            },
          },
        ],
        scale: {
          minReplicas: 0,
          maxReplicas: 1,
        },
      },
    };

    const result = await ContainerAppClient.containerApps.beginCreateOrUpdateAndWait(
      ResourceGroupName,
      AppName,
      containerApp,
    );

    return {
      AppName,
      Status: 'Deployed',
      DeploymentResult: result as any,
    };
  }) as unknown as TStepBuilder;
