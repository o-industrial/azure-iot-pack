import { z } from '../../.deps.ts';

export const AzureResolveCredentialInputSchema: z.ZodObject<{
  Method: z.ZodEnum<['token', 'clientSecret', 'oboAssertion', 'kusto']>;
  TenantId: z.ZodOptional<z.ZodString>;
  ClientId: z.ZodOptional<z.ZodString>;
  ClientSecret: z.ZodOptional<z.ZodString>;
  Token: z.ZodOptional<z.ZodString>;
  Scopes: z.ZodOptional<z.ZodArray<z.ZodString>>;
}> = z.object({
  Method: z.enum(['token', 'clientSecret', 'oboAssertion', 'kusto']),
  TenantId: z.string().optional(),
  ClientId: z.string().optional(),
  ClientSecret: z.string().optional(),
  Token: z.string().optional(),
  Scopes: z.array(z.string()).optional(),
});

export type AzureResolveCredentialInput = z.infer<
  typeof AzureResolveCredentialInputSchema
>;
