import { z } from '../../.deps.ts';

export const AzureResolveCredentialOutputSchema: z.ZodObject<{
  AccessToken: z.ZodString;
}> = z.object({
  AccessToken: z.string(),
});

export type AzureResolveCredentialOutput = z.infer<
  typeof AzureResolveCredentialOutputSchema
>;
