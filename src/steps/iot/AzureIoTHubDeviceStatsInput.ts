import { z } from '../../.deps.ts';

export const AzureIoTHubDeviceStatsInputSchema: z.ZodObject<{
  DeviceID: z.ZodString;
  IoTHubName: z.ZodString;
}> = z.object({
  DeviceID: z.string(),
  IoTHubName: z.string(),
});

export type AzureIoTHubDeviceStatsInput = z.infer<
  typeof AzureIoTHubDeviceStatsInputSchema
>;
