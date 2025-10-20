// @ts-nocheck - Azure SDK types require broader `any` usage until step scaffolding is refined
// deno-lint-ignore-file no-explicit-any
import { shaHash, Step, StepModuleBuilder, z } from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import {
  AzureResolveCredentialInputSchema,
} from '../resolve-credential/AzureResolveCredentialInput.ts';

import { MonitorClient } from 'npm:@azure/arm-monitor@7.0.0';

// ---------- Input / Output ----------

export const AzureDiagnosticsWiringInputSchema: z.ZodObject<{
  WorkspaceResourceId: z.ZodString;
  Targets: z.ZodArray<
    z.ZodObject<{
      ResourceId: z.ZodString;
      Logs?: z.ZodOptional<z.ZodArray<z.ZodString>>;
      Metrics?: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }>
  >;
}> = z.object({
  WorkspaceResourceId: z.string(),
  Targets: z.array(
    z.object({
      ResourceId: z.string(),
      Logs: z.array(z.string()).optional(),
      Metrics: z.array(z.string()).optional(),
    }),
  ),
});

export type AzureDiagnosticsWiringInput = z.infer<
  typeof AzureDiagnosticsWiringInputSchema
>;

export const AzureDiagnosticsWiringOutputSchema: z.ZodObject<{
  Applied: z.ZodArray<
    z.ZodObject<{
      ResourceId: z.ZodString;
      SettingName: z.ZodString;
    }>
  >;
}> = z.object({
  Applied: z.array(
    z.object({
      ResourceId: z.string(),
      SettingName: z.string(),
    }),
  ),
});

export type AzureDiagnosticsWiringOutput = z.infer<
  typeof AzureDiagnosticsWiringOutputSchema
>;

// ---------- Options ----------

export const AzureDiagnosticsWiringOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
}> = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
});

export type AzureDiagnosticsWiringOptions = z.infer<
  typeof AzureDiagnosticsWiringOptionsSchema
>;

// ---------- Step ----------

type TStepBuilder = StepModuleBuilder<
  AzureDiagnosticsWiringInput,
  AzureDiagnosticsWiringOutput,
  AzureDiagnosticsWiringOptions
>;

export const AzureDiagnosticsWiringStep: TStepBuilder = Step(
  'Azure Diagnostics Wiring (SDK)',
  'Applies diagnostic settings to target resources pointing at Log Analytics.',
)
  .Input(AzureDiagnosticsWiringInputSchema)
  .Output(AzureDiagnosticsWiringOutputSchema)
  .Options(AzureDiagnosticsWiringOptionsSchema)
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

    const monitorClient = new MonitorClient(
      credential as any,
      SubscriptionID,
    );

    return { MonitorClient: monitorClient };
  })
  .Run(async (rawInput, ctx) => {
    const input = rawInput as AzureDiagnosticsWiringInput;
    const services = ctx.Services as {
      MonitorClient: MonitorClient;
    };

    const applied: Array<{ ResourceId: string; SettingName: string }> = [];

    for (const target of input.Targets) {
      const hash = await shaHash(target.ResourceId, 'diag');
      const settingName = `diag-${hash.substring(0, 12)}`;

      const logsSource = target.Logs as string[] | undefined;
      const logs = logsSource?.map((category: string) => ({
        category,
        enabled: true,
        retentionPolicy: {
          enabled: false,
          days: 0,
        },
      }));

      const metricsSource = target.Metrics as string[] | undefined;
      const metrics = metricsSource?.map((category: string) => ({
        category,
        enabled: true,
        retentionPolicy: {
          enabled: false,
          days: 0,
        },
      }));

      await services.MonitorClient.diagnosticSettings.createOrUpdate(
        target.ResourceId,
        settingName,
        {
          workspaceId: input.WorkspaceResourceId,
          logs,
          metrics,
        },
      );

      applied.push({
        ResourceId: target.ResourceId,
        SettingName: settingName,
      });
    }

    return {
      Applied: applied,
    };
  }) as unknown as TStepBuilder;
