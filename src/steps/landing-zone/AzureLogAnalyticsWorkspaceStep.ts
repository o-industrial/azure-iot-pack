// @ts-nocheck - Azure SDK types require broader `any` usage until step scaffolding is refined
// deno-lint-ignore-file no-explicit-any
import { Step, StepModuleBuilder, z } from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import {
  AzureResolveCredentialInputSchema,
} from '../resolve-credential/AzureResolveCredentialInput.ts';

import { OperationalInsightsManagementClient } from 'npm:@azure/arm-operationalinsights@9.0.0';

// ---------- Input / Output ----------

export const AzureLogAnalyticsWorkspaceInputSchema: z.ZodObject<{
  WorkspaceName: z.ZodString;
  Location: z.ZodString;
  ResourceGroupName: z.ZodString;
  RetentionInDays?: z.ZodOptional<z.ZodNumber>;
  Tags?: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}> = z.object({
  WorkspaceName: z.string(),
  Location: z.string(),
  ResourceGroupName: z.string(),
  RetentionInDays: z.number().optional(),
  Tags: z.record(z.string()).optional(),
});

export type AzureLogAnalyticsWorkspaceInput = z.infer<
  typeof AzureLogAnalyticsWorkspaceInputSchema
>;

export const AzureLogAnalyticsWorkspaceOutputSchema: z.ZodObject<{
  WorkspaceId: z.ZodString;
  CustomerId: z.ZodString;
  PrimarySharedKey?: z.ZodOptional<z.ZodString>;
}> = z.object({
  WorkspaceId: z.string(),
  CustomerId: z.string(),
  PrimarySharedKey: z.string().optional(),
});

export type AzureLogAnalyticsWorkspaceOutput = z.infer<
  typeof AzureLogAnalyticsWorkspaceOutputSchema
>;

// ---------- Options ----------

export const AzureLogAnalyticsWorkspaceOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
  RetrieveSharedKeys?: z.ZodOptional<z.ZodBoolean>;
}> = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
  RetrieveSharedKeys: z.boolean().optional(),
});

export type AzureLogAnalyticsWorkspaceOptions = z.infer<
  typeof AzureLogAnalyticsWorkspaceOptionsSchema
>;

// ---------- Step ----------

type TStepBuilder = StepModuleBuilder<
  AzureLogAnalyticsWorkspaceInput,
  AzureLogAnalyticsWorkspaceOutput,
  AzureLogAnalyticsWorkspaceOptions
>;

export const AzureLogAnalyticsWorkspaceStep: TStepBuilder = Step(
  'Azure Log Analytics Workspace (SDK)',
  'Creates or updates a Log Analytics workspace and optionally returns the shared key.',
)
  .Input(AzureLogAnalyticsWorkspaceInputSchema)
  .Output(AzureLogAnalyticsWorkspaceOutputSchema)
  .Options(AzureLogAnalyticsWorkspaceOptionsSchema)
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

    const InsightsClient = new OperationalInsightsManagementClient(
      credential as any,
      SubscriptionID,
    );

    return { InsightsClient };
  })
  .Run(async (rawInput, rawCtx) => {
    const input = rawInput as AzureLogAnalyticsWorkspaceInput;
    const options = (rawCtx.Options ?? {}) as AzureLogAnalyticsWorkspaceOptions;
    const { InsightsClient } = rawCtx.Services as {
      InsightsClient: OperationalInsightsManagementClient;
    };
    const {
      WorkspaceName,
      Location,
      ResourceGroupName,
      RetentionInDays,
      Tags,
    } = input;

    const retentionInDays = typeof RetentionInDays === 'number' ? RetentionInDays : undefined;
    const tagsRecord = (Tags ?? undefined) as Record<string, string> | undefined;
    const { RetrieveSharedKeys } = options;

    const workspaceResult = await InsightsClient.workspaces
      .beginCreateOrUpdateAndWait(ResourceGroupName, WorkspaceName, {
        location: Location,
        retentionInDays,
        sku: {
          name: 'PerGB2018',
        },
        tags: tagsRecord,
      });

    let primarySharedKey: string | undefined;

    if (RetrieveSharedKeys) {
      const keys = await InsightsClient.sharedKeysOperations.getSharedKeys(
        ResourceGroupName,
        WorkspaceName,
      );
      primarySharedKey = keys.primarySharedKey ?? undefined;
    }

    return {
      WorkspaceId: workspaceResult.id ?? '',
      CustomerId: workspaceResult.customerId ?? '',
      PrimarySharedKey: primarySharedKey,
    };
  }) as unknown as TStepBuilder;
