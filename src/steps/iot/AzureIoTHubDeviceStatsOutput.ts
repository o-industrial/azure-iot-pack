import { DataConnectionStatsSchema, z } from '../../.deps.ts';

export const AzureIoTHubDeviceStatsOutputSchema = DataConnectionStatsSchema;

export type AzureIoTHubDeviceStatsOutput = z.infer<
  typeof DataConnectionStatsSchema
>;
