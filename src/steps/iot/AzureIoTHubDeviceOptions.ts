import { z } from '../../.deps.ts';
import { AzureResolveCredentialInputSchema } from '../resolve-credential/AzureResolveCredentialInput.ts';

export const AzureIoTHubDeviceOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  ResourceGroupName: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
}> = z.object({
  SubscriptionID: z.string().describe('Azure subscription ID'),
  ResourceGroupName: z.string().describe('Azure resource group name'),
  CredentialStrategy: AzureResolveCredentialInputSchema,
});

export type AzureIoTHubDeviceOptions = z.infer<
  typeof AzureIoTHubDeviceOptionsSchema
>;
