export {
  type EaCAzureDockerSimulatorDetails,
  type EaCAzureIoTHubDataConnectionDetails,
  type EaCDataConnectionAsCode,
  type EaCSharedSimulatorDetails,
  type EaCSimulatorAsCode,
  isEaCAzureIoTHubDataConnectionDetails,
} from 'jsr:@o-industrial/common@0.0.488-hmis/eac';
export {
  DataConnection,
  DataConnectionModuleBuilder,
} from 'jsr:@o-industrial/common@0.0.488-hmis/fluent/connections';
export {
  Simulator,
  SimulatorModuleBuilder,
} from 'jsr:@o-industrial/common@0.0.488-hmis/fluent/simulators';
export { Step, StepModuleBuilder } from 'jsr:@o-industrial/common@0.0.488-hmis/fluent/steps';
export {
  WarmQuery,
  WarmQueryModuleBuilder,
} from 'jsr:@o-industrial/common@0.0.488-hmis/fluent/warm-queries';

export {
  type AzureDataExplorerOutput,
  AzureDataExplorerOutputSchema,
} from 'jsr:@o-industrial/common@0.0.488-hmis/types';

export { shaHash } from 'jsr:@o-industrial/common@0.0.488-hmis/utils/client';

export { DataConnectionStatsSchema } from 'jsr:@o-industrial/oi-core-pack@0.0.34-hmis/connections';

export type { Status } from 'jsr:@fathym/common@0.2.274';
export { z } from 'jsr:@fathym/common@0.2.274/third-party/zod';

export type { EaCWarmQueryAsCode } from 'jsr:@fathym/eac-azure@0.0.116';
export {
  applyDevUserGraphTags,
  applyDevUserTag,
  getDevUser,
  withDevUserGraphTags,
  withDevUserTag,
} from 'jsr:@fathym/eac-azure@0.0.116/utils';

export { IotHubClient } from 'npm:@azure/arm-iothub@6.3.0';
export { Registry as IoTRegistry } from 'npm:azure-iothub@1.16.5';

export type { AccessToken } from 'npm:@azure/core-auth@1.9.0';
export {
  ClientSecretCredential,
  DefaultAzureCredential,
  type TokenCredential,
} from 'npm:@azure/identity@4.10.0';

export { ConfidentialClientApplication } from 'npm:@azure/msal-node@3.6.0';
