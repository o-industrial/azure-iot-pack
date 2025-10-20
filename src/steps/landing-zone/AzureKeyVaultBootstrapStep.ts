// @ts-nocheck - Azure SDK types require broader `any` usage until step scaffolding is refined
// deno-lint-ignore-file no-explicit-any
import { Step, StepModuleBuilder, z } from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import {
  AzureResolveCredentialInputSchema,
} from '../resolve-credential/AzureResolveCredentialInput.ts';

import {
  KeyVaultManagementClient,
  VaultAccessPolicyProperties,
} from 'npm:@azure/arm-keyvault@3.2.0';

// ---------- Input / Output ----------

export const AzureKeyVaultBootstrapInputSchema: z.ZodObject<{
  VaultName: z.ZodString;
  Location: z.ZodString;
  ResourceGroupName: z.ZodString;
  AccessPolicies?: z.ZodOptional<
    z.ZodArray<
      z.ZodObject<{
        TenantId: z.ZodString;
        ObjectId: z.ZodString;
        Permissions: z.ZodObject<{
          Keys?: z.ZodOptional<z.ZodArray<z.ZodString>>;
          Secrets?: z.ZodOptional<z.ZodArray<z.ZodString>>;
          Certificates?: z.ZodOptional<z.ZodArray<z.ZodString>>;
          Storage?: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }>;
      }>
    >
  >;
  Tags?: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}> = z.object({
  VaultName: z.string(),
  Location: z.string(),
  ResourceGroupName: z.string(),
  AccessPolicies: z.array(
    z.object({
      TenantId: z.string(),
      ObjectId: z.string(),
      Permissions: z.object({
        Keys: z.array(z.string()).optional(),
        Secrets: z.array(z.string()).optional(),
        Certificates: z.array(z.string()).optional(),
        Storage: z.array(z.string()).optional(),
      }),
    }),
  ).optional(),
  Tags: z.record(z.string()).optional(),
});

export type AzureKeyVaultBootstrapInput = z.infer<
  typeof AzureKeyVaultBootstrapInputSchema
>;

export const AzureKeyVaultBootstrapOutputSchema: z.ZodObject<{
  VaultId: z.ZodString;
  VaultUri: z.ZodString;
}> = z.object({
  VaultId: z.string(),
  VaultUri: z.string(),
});

export type AzureKeyVaultBootstrapOutput = z.infer<
  typeof AzureKeyVaultBootstrapOutputSchema
>;

// ---------- Options ----------

export const AzureKeyVaultBootstrapOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
  TenantId: z.ZodString;
}> = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
  TenantId: z.string(),
});

export type AzureKeyVaultBootstrapOptions = z.infer<
  typeof AzureKeyVaultBootstrapOptionsSchema
>;

// ---------- Step ----------

type TStepBuilder = StepModuleBuilder<
  AzureKeyVaultBootstrapInput,
  AzureKeyVaultBootstrapOutput,
  AzureKeyVaultBootstrapOptions
>;

export const AzureKeyVaultBootstrapStep: TStepBuilder = Step(
  'Azure Key Vault Bootstrap (SDK)',
  'Creates or updates a Key Vault with provided access policies.',
)
  .Input(AzureKeyVaultBootstrapInputSchema)
  .Output(AzureKeyVaultBootstrapOutputSchema)
  .Options(AzureKeyVaultBootstrapOptionsSchema)
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

    const KeyVaultClient = new KeyVaultManagementClient(
      credential as any,
      SubscriptionID,
    );

    return { KeyVaultClient };
  })
  .Run(async (rawInput, rawCtx) => {
    const input = rawInput as AzureKeyVaultBootstrapInput;
    const options = rawCtx.Options! as AzureKeyVaultBootstrapOptions;
    const { KeyVaultClient } = rawCtx.Services as {
      KeyVaultClient: KeyVaultManagementClient;
    };

    const {
      VaultName,
      Location,
      ResourceGroupName,
      AccessPolicies,
    } = input;
    const { TenantId } = options;
    const tagsRecord = (input.Tags ?? undefined) as Record<string, string> | undefined;

    const policies: VaultAccessPolicyProperties[] | undefined = AccessPolicies
      ?.map((policy) => ({
        tenantId: policy.TenantId,
        objectId: policy.ObjectId,
        permissions: {
          keys: policy.Permissions.Keys,
          secrets: policy.Permissions.Secrets,
          certificates: policy.Permissions.Certificates,
          storage: policy.Permissions.Storage,
        },
      }));

    const vaultResult = await KeyVaultClient.vaults
      .beginCreateOrUpdateAndWait(ResourceGroupName, VaultName, {
        location: Location,
        properties: {
          tenantId: TenantId,
          sku: {
            name: 'standard',
            family: 'A',
          },
          accessPolicies: policies,
          enabledForDeployment: true,
          enabledForTemplateDeployment: true,
          enableSoftDelete: true,
          softDeleteRetentionInDays: 90,
        },
        tags: tagsRecord,
      });

    return {
      VaultId: vaultResult.id ?? '',
      VaultUri: vaultResult.properties?.vaultUri ?? '',
    };
  }) as unknown as TStepBuilder;
