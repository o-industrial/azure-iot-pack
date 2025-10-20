// @ts-nocheck - Azure SDK types require broader `any` usage until step scaffolding is refined
// deno-lint-ignore-file no-explicit-any
import { Step, StepModuleBuilder, z } from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import {
  AzureResolveCredentialInputSchema,
} from '../resolve-credential/AzureResolveCredentialInput.ts';

import { Provider, Providers, ResourceManagementClient } from 'npm:@azure/arm-resources@6.1.0';

// ---------- Input / Output ----------

export const AzureEnsureProvidersInputSchema: z.ZodType<{
  Providers?: string[];
}> = z.object({
  Providers: z.array(z.string()).optional(),
});

export type AzureEnsureProvidersInput = z.infer<
  typeof AzureEnsureProvidersInputSchema
>;

export const AzureEnsureProvidersOutputSchema: z.ZodObject<{
  Registered: z.ZodRecord<z.ZodString, z.ZodString>;
  Regions: z.ZodArray<
    z.ZodObject<{
      name: z.ZodString;
      displayName: z.ZodOptional<z.ZodString>;
    }>
  >;
}> = z.object({
  Registered: z.record(z.string()),
  Regions: z.array(
    z.object({
      name: z.string(),
      displayName: z.string().optional(),
    }),
  ),
});

export type AzureEnsureProvidersOutput = z.infer<
  typeof AzureEnsureProvidersOutputSchema
>;

// ---------- Options ----------

export const AzureEnsureProvidersOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
  DefaultProviders: z.ZodArray<z.ZodString>;
}> = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
  DefaultProviders: z.array(z.string()).default([
    'Microsoft.Resources',
    'Microsoft.Network',
    'Microsoft.KeyVault',
    'Microsoft.OperationalInsights',
    'Microsoft.Insights',
    'Microsoft.Authorization',
  ]),
});

export type AzureEnsureProvidersOptions = z.infer<
  typeof AzureEnsureProvidersOptionsSchema
>;

// ---------- Step ----------

type TStepBuilder = StepModuleBuilder<
  AzureEnsureProvidersInput,
  AzureEnsureProvidersOutput,
  AzureEnsureProvidersOptions
>;

const pollProviderRegistration = async (
  providersClient: Providers,
  providerNamespace: string,
): Promise<Provider | undefined> => {
  // Poll for provider registration status; Azure may take a few seconds to update.
  const maxAttempts = 10;
  const delayMs = 3_000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const provider = await providersClient.get(providerNamespace);
    const state = provider.registrationState?.toLowerCase();

    if (state === 'registered' || state === 'registering') {
      return provider;
    }

    // Wait before checking again.
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return providersClient.get(providerNamespace);
};

export const AzureEnsureProvidersStep: TStepBuilder = Step(
  'Azure Provider Registration (SDK)',
  'Ensures required Azure resource providers are registered and returns subscription regions.',
)
  .Input(AzureEnsureProvidersInputSchema)
  .Output(AzureEnsureProvidersOutputSchema)
  .Options(AzureEnsureProvidersOptionsSchema)
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

    return { ResourcesClient };
  })
  .Run(async (input, ctx) => {
    const { DefaultProviders, SubscriptionID } = ctx.Options!;
    const { ResourcesClient } = ctx.Services!;

    const providersToEnsure = input.Providers?.length ? input.Providers : DefaultProviders;

    const registrationResults: Record<string, string> = {};

    for (const providerNamespace of providersToEnsure) {
      try {
        const provider = await ResourcesClient.providers.get(providerNamespace);
        const currentState = provider.registrationState ?? 'NotRegistered';

        if (!currentState || currentState.toLowerCase() !== 'registered') {
          await ResourcesClient.providers.register(providerNamespace);
        }

        const finalProvider = await pollProviderRegistration(
          ResourcesClient.providers,
          providerNamespace,
        );

        registrationResults[providerNamespace] = finalProvider
          ?.registrationState ?? 'Unknown';
      } catch (err) {
        registrationResults[providerNamespace] = `Error: ${(err as Error).message}`;
      }
    }

    const regionResponse = await ResourcesClient.subscriptions.listLocations(
      SubscriptionID,
    );

    const Regions = regionResponse
      ?.map((location) => ({
        name: location.name ?? '',
        displayName: location.displayName ?? undefined,
      }))
      .filter((region) => region.name);

    return {
      Registered: registrationResults,
      Regions: Regions ?? [],
    };
  }) as unknown as TStepBuilder;
