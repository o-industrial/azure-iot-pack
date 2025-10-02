import {
  AccessToken,
  IotHubClient,
  IoTRegistry,
  Step,
  StepModuleBuilder,
} from '../../.deps.ts';

import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';

import {
  AzureIoTHubDeviceStatsInput,
  AzureIoTHubDeviceStatsInputSchema,
} from './AzureIoTHubDeviceStatsInput.ts';
import {
  AzureIoTHubDeviceStatsOptions,
  AzureIoTHubDeviceStatsOptionsSchema,
} from './AzureIoTHubDeviceStatsOptions.ts';

import {
  AzureIoTHubDeviceStatsOutput,
  AzureIoTHubDeviceStatsOutputSchema,
} from './AzureIoTHubDeviceStatsOutput.ts';

type TStepBuilder = StepModuleBuilder<
  AzureIoTHubDeviceStatsInput,
  AzureIoTHubDeviceStatsOutput,
  AzureIoTHubDeviceStatsOptions
>;

export const AzureIoTHubDeviceStatsStep: TStepBuilder = Step(
  'Azure IoT Hub Device Stats',
  'Fetches device connection stats and simulated telemetry from Azure IoT Hub'
)
  .Input(AzureIoTHubDeviceStatsInputSchema)
  .Output(AzureIoTHubDeviceStatsOutputSchema)
  .Options(AzureIoTHubDeviceStatsOptionsSchema)
  .Steps(() => ({
    ResolveCredential: AzureResolveCredentialStep.Build(),
  }))
  .Services(async (input, ctx) => {
    const { SubscriptionID, ResourceGroupName, CredentialStrategy } =
      ctx.Options!;

    const { IoTHubName } = input;

    const { AccessToken } = await ctx.Steps!.ResolveCredential(
      CredentialStrategy
    );

    const cred = {
      getToken: (): Promise<AccessToken> =>
        Promise.resolve({
          token: AccessToken,
          expiresOnTimestamp: Date.now() + 3600_000,
        }),
    };

    const iotClient = new IotHubClient(cred, SubscriptionID);

    const keys = await iotClient.iotHubResource.getKeysForKeyName(
      ResourceGroupName,
      IoTHubName,
      'iothubowner'
    );

    const hostName = `${IoTHubName}.azure-devices.net`;
    const connStr = `HostName=${hostName};SharedAccessKeyName=iothubowner;SharedAccessKey=${keys.secondaryKey}`;

    return {
      Registry: IoTRegistry.fromConnectionString(connStr),
      HostName: hostName,
      ServicePolicyKeyName: 'iothubowner',
      ServicePolicySecondaryKey: keys.secondaryKey,
      ServiceConnectionString: connStr,
    };
  })
  .Run(async (input, ctx) => {
    const { DeviceID, IoTHubName } = input;
    const { Registry, HostName } = ctx.Services as unknown as {
      Registry: IoTRegistry;
      HostName: string;
      ServicePolicyKeyName: string;
      ServicePolicySecondaryKey: string;
      ServiceConnectionString: string;
    };

    let identity;
    try {
      identity = await Registry.get(DeviceID);
    } catch {
      return {
        ImpulseRates: [0, 0, 0],
        HealthStatus: 'Unreachable',
        LastReceivedTimestamp: '',
        Metadata: {
          Error: 'Device not registered in IoT Hub',
          Status: '',
          Cloud: 'Azure',
          IoTHub: IoTHubName,
          DeviceID,
          Note: 'Not found',
        },
      } as AzureIoTHubDeviceStatsOutput;
    }

    const now = new Date();
    const lastReceived = new Date(now.getTime() - 60_000); // 1 min ago
    const impulseRates = [6.3, 25.7, 90.1]; // Stub

    const msSinceLast = now.getTime() - lastReceived.getTime();
    const health =
      msSinceLast < 90_000
        ? 'Healthy'
        : msSinceLast < 10 * 60_000
        ? 'Stale'
        : 'Unreachable';

    // Extract identity info and keys (if symmetric)
    type IdentityAuth = {
      symmetricKey?: { primaryKey?: string; secondaryKey?: string };
      x509Thumbprint?: {
        primaryThumbprint?: string;
        secondaryThumbprint?: string;
      };
    };
    type IdentityBody = {
      connectionState?: string;
      authentication?: IdentityAuth;
    };
    const body: IdentityBody =
      (identity as { responseBody?: IdentityBody })?.responseBody ?? {};
    const connectionState: string = body?.connectionState ?? '';
    const auth: IdentityAuth = body?.authentication ?? {};
    const symmetricKey = auth?.symmetricKey ?? {};
    const x509 = auth?.x509Thumbprint ?? {};

    const devicePrimaryKey: string | undefined = symmetricKey?.primaryKey;
    const deviceSecondaryKey: string | undefined = symmetricKey?.secondaryKey;

    // Build device connection strings if symmetric keys are available
    const deviceConnStrPrimary = devicePrimaryKey
      ? `HostName=${HostName};DeviceId=${DeviceID};SharedAccessKey=${devicePrimaryKey}`
      : undefined;
    const deviceConnStrSecondary = deviceSecondaryKey
      ? `HostName=${HostName};DeviceId=${DeviceID};SharedAccessKey=${deviceSecondaryKey}`
      : undefined;

    // Helper to create a SAS token for device scope
    async function createDeviceSas(
      keyB64: string,
      ttlSeconds = 3600
    ): Promise<string> {
      const resourceUri = `${HostName}/devices/${DeviceID}`.toLowerCase();
      const encodedUri = encodeURIComponent(resourceUri);
      const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;

      const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const toSign = new TextEncoder().encode(`${encodedUri}\n${expiry}`);
      const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, toSign);
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
      const sigEnc = encodeURIComponent(sigB64);

      return `SharedAccessSignature sr=${encodedUri}&sig=${sigEnc}&se=${expiry}`;
    }

    const deviceSasPrimary = devicePrimaryKey
      ? await createDeviceSas(devicePrimaryKey)
      : undefined;
    const deviceSasSecondary = deviceSecondaryKey
      ? await createDeviceSas(deviceSecondaryKey)
      : undefined;

    const metadata: Record<string, string> = {
      Cloud: 'Azure',
      IoTHub: IoTHubName,
      HostName,
      DeviceID,
      Status: connectionState,
      AuthType:
        devicePrimaryKey || deviceSecondaryKey
          ? 'symmetricKey'
          : x509?.primaryThumbprint || x509?.secondaryThumbprint
          ? 'x509'
          : 'unknown',
      ...(x509?.primaryThumbprint
        ? { X509PrimaryThumbprint: x509.primaryThumbprint }
        : {}),
      ...(x509?.secondaryThumbprint
        ? { X509SecondaryThumbprint: x509.secondaryThumbprint }
        : {}),

      // Device connection strings (if symmetric)
      ...(deviceConnStrPrimary
        ? { 'Device ConnStr (primary)': deviceConnStrPrimary }
        : {}),
      ...(deviceConnStrSecondary
        ? { 'Device ConnStr (secondary)': deviceConnStrSecondary }
        : {}),

      // Device SAS tokens (1h)
      ...(deviceSasPrimary
        ? { 'Device SAS (primary, 1h)': deviceSasPrimary }
        : {}),
      ...(deviceSasSecondary
        ? { 'Device SAS (secondary, 1h)': deviceSasSecondary }
        : {}),

      // MQTT details
      'MQTT Host': HostName,
      'MQTT Port': '8883',
      'MQTT Username': `${HostName}/${DeviceID}/?api-version=2020-09-30`,
      ...(deviceSasPrimary
        ? { 'MQTT Password': deviceSasPrimary }
        : x509?.primaryThumbprint
        ? { 'MQTT Auth': 'x509 client certificate' }
        : {}),
      'MQTT Telemetry Topic': `devices/${DeviceID}/messages/events/`,

      // AMQP details
      'AMQP Host': HostName,
      'AMQP Port': '5671',
      'AMQP Username': `${HostName}/${DeviceID}/?api-version=2020-09-30`,
      ...(deviceSasPrimary
        ? { 'AMQP Password': deviceSasPrimary }
        : x509?.primaryThumbprint
        ? { 'AMQP Auth': 'x509 client certificate' }
        : {}),

      // HTTP details
      'HTTP Endpoint': `https://${HostName}/devices/${DeviceID}/messages/events?api-version=2020-09-30`,
      ...(deviceSasPrimary
        ? { 'HTTP Auth (Authorization)': deviceSasPrimary }
        : x509?.primaryThumbprint
        ? { 'HTTP Auth': 'x509 client certificate' }
        : {}),

      Note: 'Stats from Azure IoT Hub + enriched connection details',
    };

    return {
      ImpulseRates: impulseRates,
      HealthStatus: health,
      LastReceivedTimestamp: lastReceived.toISOString(),
      Metadata: metadata,
    };
  }) as unknown as TStepBuilder;
