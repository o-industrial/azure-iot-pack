// @ts-nocheck - Azure SDK types require broader `any` usage until step scaffolding is refined
// deno-lint-ignore-file no-explicit-any
import { shaHash, Step, StepModuleBuilder, withDevUserTag, z } from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import {
  AzureResolveCredentialInputSchema,
} from '../resolve-credential/AzureResolveCredentialInput.ts';

import { ResourceManagementClient } from 'npm:@azure/arm-resources@6.1.0';
import { NetworkManagementClient } from 'npm:@azure/arm-network@34.0.0';

// ---------- Input / Output ----------

export const AzureLandingZoneFoundationInputSchema: z.ZodObject<{
  WorkspaceLookup?: z.ZodOptional<z.ZodString>;
  ResourceGroup: z.ZodObject<{
    Name?: z.ZodOptional<z.ZodString>;
    Location: z.ZodString;
    Tags?: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  }>;
  Network?: z.ZodOptional<
    z.ZodObject<{
      Name: z.ZodString;
      AddressSpace: z.ZodString;
      Subnets: z.ZodArray<
        z.ZodObject<{
          Name: z.ZodString;
          AddressPrefix: z.ZodString;
        }>
      >;
    }>
  >;
}> = z.object({
  WorkspaceLookup: z.string().optional(),
  ResourceGroup: z.object({
    Name: z.string().optional(),
    Location: z.string(),
    Tags: z.record(z.string()).optional(),
  }),
  Network: z.object({
    Name: z.string(),
    AddressSpace: z.string(),
    Subnets: z.array(
      z.object({
        Name: z.string(),
        AddressPrefix: z.string(),
      }),
    ),
  }).optional(),
});

export type AzureLandingZoneFoundationInput = z.infer<
  typeof AzureLandingZoneFoundationInputSchema
>;

export const AzureLandingZoneFoundationOutputSchema: z.ZodObject<{
  ResourceGroup: z.ZodObject<{
    Name: z.ZodString;
    Id: z.ZodString;
    Location: z.ZodString;
  }>;
  Network?: z.ZodOptional<
    z.ZodObject<{
      Id: z.ZodString;
      SubnetIds: z.ZodRecord<z.ZodString, z.ZodString>;
    }>
  >;
}> = z.object({
  ResourceGroup: z.object({
    Name: z.string(),
    Id: z.string(),
    Location: z.string(),
  }),
  Network: z.object({
    Id: z.string(),
    SubnetIds: z.record(z.string()),
  }).optional(),
});

export type AzureLandingZoneFoundationOutput = z.infer<
  typeof AzureLandingZoneFoundationOutputSchema
>;

// ---------- Options ----------

export const AzureLandingZoneFoundationOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
  ResourceGroupRoot?: z.ZodOptional<z.ZodString>;
  DefaultTags?: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}> = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
  ResourceGroupRoot: z.string().optional(),
  DefaultTags: z.record(z.string()).optional(),
});

export type AzureLandingZoneFoundationOptions = z.infer<
  typeof AzureLandingZoneFoundationOptionsSchema
>;

// ---------- Step ----------

type TStepBuilder = StepModuleBuilder<
  AzureLandingZoneFoundationInput,
  AzureLandingZoneFoundationOutput,
  AzureLandingZoneFoundationOptions
>;

export const AzureLandingZoneFoundationStep: TStepBuilder = Step(
  'Azure Landing Zone Foundation (SDK)',
  'Ensures the landing zone resource group, tags, and optional networking are provisioned.',
)
  .Input(AzureLandingZoneFoundationInputSchema)
  .Output(AzureLandingZoneFoundationOutputSchema)
  .Options(AzureLandingZoneFoundationOptionsSchema)
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
          expiresOnTimestamp: Date.now() + 3_600 * 1000,
        };
      },
    };

    const ResourcesClient = new ResourceManagementClient(
      credential as any,
      SubscriptionID,
    );
    const NetworkClient = new NetworkManagementClient(
      credential as any,
      SubscriptionID,
    );

    return {
      ResourcesClient,
      NetworkClient,
    };
  })
  .Run(async (rawInput, rawCtx) => {
    const input = rawInput as AzureLandingZoneFoundationInput;
    const options = (rawCtx.Options ?? {}) as AzureLandingZoneFoundationOptions;
    const { ResourcesClient, NetworkClient } = rawCtx.Services as {
      ResourcesClient: ResourceManagementClient;
      NetworkClient: NetworkManagementClient;
    };

    const workspaceLookup = input.WorkspaceLookup as string | undefined;
    const resourceGroupInput = input.ResourceGroup as {
      Name?: string;
      Location: string;
      Tags?: Record<string, string> | undefined;
    };
    const networkInput = input.Network as {
      Name: string;
      AddressSpace: string;
      Subnets: Array<{ Name: string; AddressPrefix: string }>;
    } | undefined;

    let resourceGroupName: string | undefined = resourceGroupInput.Name;

    if (!resourceGroupName) {
      if (!workspaceLookup) {
        throw new Error(
          'Either ResourceGroup.Name or WorkspaceLookup must be provided.',
        );
      }

      const base = options.ResourceGroupRoot ??
        Deno.env.get('OPEN_INDUSTRIAL_RESOURCE_GROUP_ROOT') ??
        'oi-found';

      const hash = await shaHash(workspaceLookup!, '');
      resourceGroupName = `${base}-${hash}`;
    }

    if (!resourceGroupName) {
      throw new Error('Unable to resolve a resource group name.');
    }
    const finalResourceGroupName = resourceGroupName as string;

    const mergedTags: Record<string, string> = {
      ...(options.DefaultTags ?? {}),
      ...(resourceGroupInput.Tags ?? {}),
    };

    const tagged = workspaceLookup
      ? withDevUserTag({
        WorkspaceLookup: workspaceLookup as string,
        ...mergedTags,
      })
      : mergedTags;

    const resourceGroupResult = await ResourcesClient.resourceGroups
      .createOrUpdate(finalResourceGroupName, {
        location: resourceGroupInput.Location,
        tags: tagged,
      });

    const subnetIds: Record<string, string> = {};
    let networkResult: any | undefined;

    if (networkInput) {
      const subnetPayload = networkInput.Subnets.map((subnet) => ({
        name: subnet.Name,
        addressPrefix: subnet.AddressPrefix,
      }));

      networkResult = await NetworkClient.virtualNetworks
        .beginCreateOrUpdateAndWait(
          finalResourceGroupName,
          networkInput.Name,
          {
            location: resourceGroupInput.Location,
            addressSpace: {
              addressPrefixes: [networkInput.AddressSpace],
            },
            subnets: subnetPayload,
            tags: tagged,
          } as any,
        );

      networkResult?.subnets?.forEach((subnet: { name?: string; id?: string }) => {
        if (subnet?.name && subnet?.id) {
          subnetIds[subnet.name] = subnet.id;
        }
      });
    }

    return {
      ResourceGroup: {
        Name: finalResourceGroupName,
        Id: resourceGroupResult.id ?? '',
        Location: resourceGroupResult.location ?? resourceGroupInput.Location,
      },
      Network: networkResult
        ? {
          Id: networkResult.id ?? '',
          SubnetIds: subnetIds,
        }
        : undefined,
    };
  }) as unknown as TStepBuilder;
