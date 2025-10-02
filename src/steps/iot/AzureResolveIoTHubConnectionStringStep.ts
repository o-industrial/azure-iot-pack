import {
  type AccessToken,
  IotHubClient,
  Step,
  StepModuleBuilder,
  z,
} from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import { AzureResolveCredentialInputSchema } from '../resolve-credential/AzureResolveCredentialInput.ts';

// ---------- Input / Output ----------

export const AzureResolveIoTHubConnectionStringInputSchema = z.object({
  KeyName: z.string().default('iothubowner'),
  IoTHubName: z.string().optional(),
  ResourceGroupName: z.string(),
});

export const AzureResolveIoTHubConnectionStringOutputSchema = z.object({
  ConnectionString: z.string(),
  IoTHubName: z.string(),
});

export const AzureResolveIoTHubConnectionStringOptionsSchema = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
});

export type AzureResolveIoTHubConnectionStringInput = z.infer<
  typeof AzureResolveIoTHubConnectionStringInputSchema
>;

export type AzureResolveIoTHubConnectionStringOutput = z.infer<
  typeof AzureResolveIoTHubConnectionStringOutputSchema
>;

export type AzureResolveIoTHubConnectionStringOptions = z.infer<
  typeof AzureResolveIoTHubConnectionStringOptionsSchema
>;

// ---------- Step ----------

type TStepBuilder = StepModuleBuilder<
  AzureResolveIoTHubConnectionStringInput,
  AzureResolveIoTHubConnectionStringOutput,
  AzureResolveIoTHubConnectionStringOptions
>;

export const AzureResolveIoTHubConnectionStringStep: TStepBuilder = Step(
  'Resolve Azure IoT Hub Connection String',
  'Retrieves the connection string for a named key on the derived IoT Hub'
)
  .Input(AzureResolveIoTHubConnectionStringInputSchema)
  .Output(AzureResolveIoTHubConnectionStringOutputSchema)
  .Options(AzureResolveIoTHubConnectionStringOptionsSchema)
  .Steps(() => ({
    ResolveCredential: AzureResolveCredentialStep.Build(),
  }))
  .Services(async (_input, ctx) => {
    const { SubscriptionID, CredentialStrategy } = ctx.Options!;

    const { AccessToken } = await ctx.Steps!.ResolveCredential(
      CredentialStrategy
    );

    const cred = {
      getToken: (): Promise<AccessToken> =>
        Promise.resolve({
          token: AccessToken,
          expiresOnTimestamp: Date.now() + 3600 * 1000,
        }),
    };

    const IotClient = new IotHubClient(cred, SubscriptionID);

    return { IotClient };
  })
  .Run(async (input, ctx) => {
    const { IotClient } = ctx.Services!;
    let { KeyName, IoTHubName, ResourceGroupName } = input;

    const shortName = ResourceGroupName.split('-')
      .map((s) => s[0])
      .join('');

    IoTHubName ||= `${shortName}-iot-hub`;

    const keys = await IotClient.iotHubResource.getKeysForKeyName(
      ResourceGroupName,
      IoTHubName,
      KeyName ?? 'device'
    );

    const connStr = `HostName=${IoTHubName}.azure-devices.net;SharedAccessKeyName=${KeyName};SharedAccessKey=${keys.secondaryKey}`;

    return {
      ConnectionString: connStr,
      IoTHubName,
    };
  }) as unknown as TStepBuilder;
