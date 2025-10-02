import {
  EaCAzureDockerSimulatorDetails,
  EaCSimulatorAsCode,
  isEaCAzureIoTHubDataConnectionDetails,
  shaHash,
  Simulator,
  SimulatorModuleBuilder,
  z,
} from '../.deps.ts';
import {
  AzureContainerAppJobDeployOutput,
  AzureContainerAppJobDeployOutputSchema,
  AzureContainerAppJobDeployStep,
} from '../steps/container-apps/AzureContainerAppJobDeployStep.ts';
import {
  AzureContainerAppJobStatsOutput,
  AzureContainerAppJobStatsOutputSchema,
  AzureContainerAppJobStatsStep,
} from '../steps/container-apps/AzureContainerAppJobStatsStep.ts';
import { AzureResolveCredentialInput } from '../steps/resolve-credential/AzureResolveCredentialInput.ts';
import { WorkspaceEnsureAzureResourceGroupStep } from '../steps/calz/WorkspaceEnsureAzureResourceGroupStep.ts';
import { AzureResolveIoTHubConnectionStringStep } from '../steps/iot/AzureResolveIoTHubConnectionStringStep.ts';
import { AzureContainerAppStopStep } from '../steps/container-apps/AzureContainerAppStopStep.ts';
import { AzureContainerAppStartStep } from '../steps/container-apps/AzureContainerAppStartStep.ts';

export async function safeAppName(
  workspace: string,
  id: string,
  prefix: string
): Promise<string> {
  const hash = await shaHash(workspace, id);

  const shortHash = hash.substring(0, 20);

  return `${prefix}-${shortHash}`;
}

export function AzureDockerSimulator(
  lookup: string
): SimulatorModuleBuilder<
  EaCSimulatorAsCode<EaCAzureDockerSimulatorDetails>,
  void,
  AzureContainerAppJobDeployOutput[],
  AzureContainerAppJobStatsOutput
> {
  return Simulator<
    EaCAzureDockerSimulatorDetails,
    EaCSimulatorAsCode<EaCAzureDockerSimulatorDetails>,
    void,
    AzureContainerAppJobDeployOutput[],
    AzureContainerAppJobStatsOutput
  >(lookup)
    .DeployType(z.array(AzureContainerAppJobDeployOutputSchema))
    .StatsType(AzureContainerAppJobStatsOutputSchema)
    .Steps(async ({ Secrets }) => {
      const subId = (await Secrets.Get('AZURE_IOT_SUBSCRIPTION_ID'))!;

      const credStrat: AzureResolveCredentialInput = {
        Method: 'clientSecret',
        TenantId: await Secrets.Get('AZURE_IOT_TENANT_ID'),
        ClientId: await Secrets.Get('AZURE_IOT_CLIENT_ID'),
        ClientSecret: await Secrets.Get('AZURE_IOT_CLIENT_SECRET'),
      };

      return {
        EnsureResGroup: WorkspaceEnsureAzureResourceGroupStep.Build({
          CredentialStrategy: credStrat,
          SubscriptionID: subId,
        }),
        DeployJob: AzureContainerAppJobDeployStep.Build({
          CredentialStrategy: credStrat,
          SubscriptionID: subId,
        }),
        StartApp: AzureContainerAppStartStep.Build({
          CredentialStrategy: credStrat,
          SubscriptionID: subId,
        }),
        StopApp: AzureContainerAppStopStep.Build({
          CredentialStrategy: credStrat,
          SubscriptionID: subId,
        }),
        StatsJob: AzureContainerAppJobStatsStep.Build({
          CredentialStrategy: credStrat,
          SubscriptionID: subId,
        }),
        ResolveIoTHubConnectionString:
          AzureResolveIoTHubConnectionStringStep.Build({
            SubscriptionID: subId,
            CredentialStrategy: credStrat,
          }),
      };
    })
    .Services(
      async ({ Lookup, EaC: { EnterpriseLookup: WorkspaceLookup } }) => {
        return {
          ApplicationName: await safeAppName(
            WorkspaceLookup!,
            `simulator-azure-docker-${Lookup}`,
            'sim-az-dckr'
          ),
          AppEnvironmentName: 'simulator-container-app-env',
        };
      }
    )
    .Stats(async ({ Steps, EaC, Services: { ApplicationName } }) => {
      const ensured = await Steps.EnsureResGroup({
        WorkspaceLookup: EaC.EnterpriseLookup!,
      });

      return await Steps.StatsJob({
        ResourceGroupName: ensured.ResourceGroupName,
        AppName: ApplicationName,
      });
    })
    .Deploy(
      async ({
        Steps,
        AsCode,
        Lookup: SimulatorLookup,
        EaC,
        Secrets,
        Services: { AppEnvironmentName, ApplicationName },
      }) => {
        const {
          MessageTemplate,
          Variables,
          MessageIntervalMS,
          MessageCountPerDevice,
        } = AsCode.Details ?? {};

        const ensured = await Steps.EnsureResGroup({
          WorkspaceLookup: EaC.EnterpriseLookup!,
        });

        const enabled =
          (AsCode.Metadata as { Enabled?: boolean } | undefined)?.Enabled ??
          true;

        // Compare against the previously deployed value in the current workspace EaC
        const prevEnabled = (
          EaC.Simulators?.[SimulatorLookup]?.Metadata as
            | { Enabled?: boolean }
            | undefined
        )?.Enabled;

        const hasChanged = prevEnabled === undefined || prevEnabled !== enabled;

        if (!enabled) {
          if (hasChanged) {
            await Steps.StopApp({
              ResourceGroupName: ensured.ResourceGroupName,
              AppName: ApplicationName,
            });
          }
          return [];
        }

        //  Load any Data Connectin that points at this Simulator, and for every data connection that points at this simulator, Deploy a configured job

        type t = Parameters<(typeof Steps)['DeployJob']>[0];

        const jobs: t[] = [];

        for (const [dcLookup, dc] of Object.entries(
          EaC.DataConnections || {}
        )) {
          const dcDetails = dc.Details ?? {};

          if (
            dc.SimulatorLookup === SimulatorLookup &&
            isEaCAzureIoTHubDataConnectionDetails(dcDetails)
          ) {
            const { ConnectionString } =
              await Steps.ResolveIoTHubConnectionString({
                ResourceGroupName: await Secrets.GetRequired(
                  'AZURE_IOT_RESOURCE_GROUP'
                ),
                KeyName: 'iothubowner',
              });

            const deviceId = await shaHash(EaC.EnterpriseLookup!, dcLookup);

            jobs.push({
              ResourceGroupName: ensured.ResourceGroupName,
              AppEnvironmentName: AppEnvironmentName,
              AppName: ApplicationName,
              Image:
                'mcr.microsoft.com/oss/azure-samples/azureiot-telemetrysimulator:latest',
              AppEnvironmentTags: {
                WorkspaceLookup: EaC.EnterpriseLookup!,
              },
              AppTags: {
                WorkspaceLookup: EaC.EnterpriseLookup!,
                SimulatorLookup: SimulatorLookup,
                DataConnectionLookup: dcLookup,
              },
              EnvironmentVariables: {
                IotHubConnectionString: ConnectionString, //deviceConnStr,
                DeviceList: deviceId,
                MessageCount: (MessageCountPerDevice || 0).toString(),
                Interval: (MessageIntervalMS || 60000).toString(),
                Template: MessageTemplate || '',
                Variables: Variables || '',
              },
            });
          }
        }

        const outputs = await Promise.all(
          jobs.map((job) => Steps.DeployJob(job))
        );

        // Start only if enabled value changed to enabled
        if (hasChanged) {
          await Steps.StartApp({
            ResourceGroupName: ensured.ResourceGroupName,
            AppName: ApplicationName,
          });
        }

        return outputs;
      }
    ) as unknown as SimulatorModuleBuilder<
    EaCSimulatorAsCode<EaCAzureDockerSimulatorDetails>,
    void,
    AzureContainerAppJobDeployOutput[],
    AzureContainerAppJobStatsOutput
  >;
}
