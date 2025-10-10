// deno-lint-ignore-file no-explicit-any
import {
  applyDevUserTag,
  IoTRegistry,
  shaHash,
  Step,
  StepModuleBuilder,
  withDevUserTag,
} from '../../.deps.ts';
import { AzureResolveIoTHubConnectionStringStep } from './AzureResolveIoTHubConnectionStringStep.ts';

import { AzureIoTHubDeviceInput, AzureIoTHubDeviceInputSchema } from './AzureIoTHubDeviceInput.ts';
import {
  AzureIoTHubDeviceOptions,
  AzureIoTHubDeviceOptionsSchema,
} from './AzureIoTHubDeviceOptions.ts';
import {
  AzureIoTHubDeviceOutput,
  AzureIoTHubDeviceOutputSchema,
} from './AzureIoTHubDeviceOutput.ts';

type TStepBuilder = StepModuleBuilder<
  AzureIoTHubDeviceInput,
  AzureIoTHubDeviceOutput,
  AzureIoTHubDeviceOptions
>;

type DeviceDescription = {
  deviceId: string;
  capabilities: { iotEdge: boolean };
  tags: Record<string, string>;
};

export const AzureIoTHubDeviceStep: TStepBuilder = Step(
  'Azure IoT Hub Device Provisioning',
  'Adds devices to an Azure IoT Hub and updates tags if needed',
)
  .Input(AzureIoTHubDeviceInputSchema)
  .Output(AzureIoTHubDeviceOutputSchema)
  .Options(AzureIoTHubDeviceOptionsSchema)
  .Steps((_input, ctx) => {
    const { SubscriptionID, CredentialStrategy } = ctx.Options!;

    return {
      ResolveIoTHubConnectionString: AzureResolveIoTHubConnectionStringStep.Build({
        SubscriptionID,
        CredentialStrategy,
      }),
    };
  })
  .Services(async (_input, ctx) => {
    const { ResourceGroupName } = ctx.Options!;

    const { ConnectionString, IoTHubName } = await ctx.Steps!.ResolveIoTHubConnectionString({
      ResourceGroupName,
      KeyName: 'iothubowner',
    });

    const Registry = IoTRegistry.fromConnectionString(ConnectionString);

    return {
      Registry,
      IoTHubName,
    };
  })
  .Run(async (input, ctx) => {
    const { WorkspaceLookup, Devices } = input;
    const { Registry } = ctx.Services!;

    const toAdd: DeviceDescription[] = [];
    const toUpdate: {
      deviceId: string;
      etag: string;
      tags: Record<string, string>;
    }[] = [];

    await Promise.all(
      Object.entries(Devices).map(async ([id, def]) => {
        const baseTags: Record<string, string | undefined> = {
          WorkspaceLookup,
          DeviceName: def.DeviceName,
          DataConnectionLookup: def.DataConnectionLookup,
        };

        id = await shaHash(WorkspaceLookup, id);

        try {
          const twin = (await Registry.getTwin(id)).responseBody;
          const currentTags = twin.tags ?? {};
          const desiredTags = applyDevUserTag(
            baseTags,
            currentTags,
            true,
          )!;

          const tagMismatch = Object.entries(desiredTags).some(
            ([k, v]) => currentTags[k] !== v,
          );

          if (tagMismatch) {
            toUpdate.push({ deviceId: id, tags: desiredTags, etag: twin.etag });
          }
        } catch (err) {
          if (!(err instanceof Error) || err.name !== 'DeviceNotFoundError') {
            throw err;
          }

          const desiredTags = withDevUserTag(baseTags)!;

          const device: DeviceDescription = {
            deviceId: id,
            capabilities: { iotEdge: def.IsIoTEdge ?? false },
            tags: desiredTags as DeviceDescription['tags'],
          };

          toAdd.push(device);
        }
      }),
    );

    const results: Record<string, unknown> = {};

    if (toAdd.length > 0) {
      const addResp = await Registry.addDevices(toAdd);

      const errors = (addResp as any)?.responseBody?.errors ?? [];

      if (errors.length > 0) {
        results.Errors = errors.reduce(
          (acc: Record<string, unknown>, e: any) => {
            acc[e.deviceId] = {
              Error: e.errorCode?.message ?? 'Unknown error',
              ErrorStatus: e.errorStatus,
            };
            return acc;
          },
          {},
        );
      } else {
        results.Added = toAdd.map((d) => d.deviceId);
      }
    }

    for (const update of toUpdate) {
      await Registry.updateTwin(
        update.deviceId,
        { tags: update.tags },
        update.etag,
      );
    }

    if (toUpdate.length > 0) {
      results.Updated = toUpdate.map((u) => u.deviceId);
    }

    if (!results.Added && !results.Updated) {
      results.Message = 'All devices already exist and are up to date.';
    }

    return results;
  }) as unknown as TStepBuilder;
