import { z } from '../../.deps.ts';
import { AzureResolveCredentialInputSchema } from '../resolve-credential/AzureResolveCredentialInput.ts';

export const AzureIoTHubDeviceStatsOptionsSchema: z.ZodObject<{
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
  SubscriptionID: z.ZodString;
  ResourceGroupName: z.ZodString;
}> = z.object({
  CredentialStrategy: AzureResolveCredentialInputSchema,
  SubscriptionID: z.string(),
  ResourceGroupName: z.string(),
});

export type AzureIoTHubDeviceStatsOptions = z.infer<
  typeof AzureIoTHubDeviceStatsOptionsSchema
>;
