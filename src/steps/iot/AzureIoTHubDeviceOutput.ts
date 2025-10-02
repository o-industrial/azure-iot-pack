import { z } from '../../.deps.ts';

export const AzureIoTHubDeviceOutputSchema: z.ZodObject<{
  Added: z.ZodOptional<z.ZodArray<z.ZodString, 'many'>>;
  Errors: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
  Message: z.ZodOptional<z.ZodString>;
}> = z.object({
  Added: z.array(z.string()).optional(),
  Errors: z.record(z.any()).optional(),
  Message: z.string().optional(),
});

export type AzureIoTHubDeviceOutput = z.infer<
  typeof AzureIoTHubDeviceOutputSchema
>;
