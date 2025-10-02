import { z } from '../../.deps.ts';

export const AzureIoTHubDeviceInputSchema: z.ZodObject<{
  Devices: z.ZodRecord<
    z.ZodString,
    z.ZodObject<{
      IsIoTEdge: z.ZodOptional<z.ZodBoolean>;
      DataConnectionLookup: z.ZodString;
      DeviceName: z.ZodString;
    }>
  >;
  WorkspaceLookup: z.ZodString;
}> = z.object({
  Devices: z.record(
    z.object({
      IsIoTEdge: z.boolean().optional(),
      DataConnectionLookup: z.string(),
      DeviceName: z.string(),
    }),
  ),
  WorkspaceLookup: z.string(),
});

export type AzureIoTHubDeviceInput = z.infer<
  typeof AzureIoTHubDeviceInputSchema
>;
