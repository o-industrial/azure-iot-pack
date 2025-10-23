import { assert, assertEquals } from '../../tests.deps.ts';
import { createTestStepContext } from '../_testContext.ts';
import { shaHash } from '../../../src/.deps.ts';
import {
  AzureLandingZoneFoundationOutput,
  AzureLandingZoneFoundationStep,
} from '../../../src/steps/landing-zone/AzureLandingZoneFoundationStep.ts';
import { AzureResolveCredentialInput } from '../../../src/steps/resolve-credential/AzureResolveCredentialInput.ts';

Deno.test('AzureLandingZoneFoundationStep provisions resource group and network with merged tags', async () => {
  const stepModule = AzureLandingZoneFoundationStep.Build();

  const credentialStrategy: AzureResolveCredentialInput = {
    Method: 'token',
    Token: 'fake-token',
  };

  const options = {
    SubscriptionID: 'sub-id',
    CredentialStrategy: credentialStrategy,
    ResourceGroupRoot: 'oi-found',
    DefaultTags: {
      Owner: 'platform',
    },
  };

  const runtime = new stepModule.Step(options);

  const resourceGroupCalls: Array<{
    name: string;
    payload: { location: string; tags?: Record<string, string> };
  }> = [];

  const networkCalls: Array<{
    resourceGroup: string;
    name: string;
    payload: {
      location: string;
      tags?: Record<string, string>;
      subnets: Array<{ name: string; addressPrefix: string }>;
    };
  }> = [];

  const resourcesClient = {
    resourceGroups: {
      createOrUpdate: (
        name: string,
        payload: { location: string; tags?: Record<string, string> },
      ) => {
        resourceGroupCalls.push({ name, payload });
        return Promise.resolve({
          id: `/subscriptions/${options.SubscriptionID}/resourceGroups/${name}`,
          location: payload.location,
        });
      },
    },
  };

  const networkClient = {
    virtualNetworks: {
      beginCreateOrUpdateAndWait: (
        resourceGroup: string,
        name: string,
        payload: {
          location: string;
          tags?: Record<string, string>;
          subnets: Array<{ name: string; addressPrefix: string }>;
        },
      ) => {
        networkCalls.push({ resourceGroup, name, payload });
        return Promise.resolve({
          id:
            `/subscriptions/${options.SubscriptionID}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/virtualNetworks/${name}`,
          subnets: payload.subnets.map((subnet) => ({
            name: subnet.name,
            id: `${resourceGroup}/${name}/${subnet.name}`,
          })),
        });
      },
    },
  };

  const ctx = createTestStepContext<typeof options, {
    ResourcesClient: typeof resourcesClient;
    NetworkClient: typeof networkClient;
  }>({
    Options: options,
    Services: {
      ResourcesClient: resourcesClient,
      NetworkClient: networkClient,
    },
  });

  const workspaceLookup = 'workspace-unit-test';

  Deno.env.set('DEV_USER', 'unit-user');

  try {
    const input = {
      WorkspaceLookup: workspaceLookup,
      ResourceGroup: {
        Location: 'westus2',
        Tags: {
          Environment: 'dev',
        },
      },
      Network: {
        Name: 'foundation-vnet',
        AddressSpace: '10.0.0.0/16',
        Subnets: [
          { Name: 'snet-app', AddressPrefix: '10.0.1.0/24' },
          { Name: 'snet-data', AddressPrefix: '10.0.2.0/24' },
        ],
      },
    };

    const result = await runtime.Execute(
      input,
      ctx as unknown as Parameters<typeof runtime.Execute>[1],
    ) as AzureLandingZoneFoundationOutput;

    const expectedHash = await shaHash(workspaceLookup, '');
    const expectedResourceGroupName = `${options.ResourceGroupRoot}-${expectedHash}`;

    assert(
      resourceGroupCalls.length === 1,
      'resourceGroups.createOrUpdate should be invoked exactly once',
    );
    assertEquals(resourceGroupCalls[0].name, expectedResourceGroupName);
    assert(resourceGroupCalls[0].payload.tags);
    assertEquals(resourceGroupCalls[0].payload.tags?.WorkspaceLookup, workspaceLookup);
    assertEquals(resourceGroupCalls[0].payload.tags?.Owner, 'platform');
    assertEquals(resourceGroupCalls[0].payload.tags?.Environment, 'dev');
    assertEquals(resourceGroupCalls[0].payload.tags?.DEV_USER, 'unit-user');

    assert(
      networkCalls.length === 1,
      'virtualNetworks.beginCreateOrUpdateAndWait should be called once',
    );
    assertEquals(networkCalls[0].resourceGroup, expectedResourceGroupName);
    assertEquals(networkCalls[0].payload.tags?.WorkspaceLookup, workspaceLookup);

    assertEquals(result.ResourceGroup.Name, expectedResourceGroupName);
    assertEquals(result.ResourceGroup.Location, 'westus2');
    assertEquals(
      result.ResourceGroup.Id,
      `/subscriptions/${options.SubscriptionID}/resourceGroups/${expectedResourceGroupName}`,
    );
    assert(result.Network);
    const networkResult = result.Network as unknown as {
      Id: string;
      SubnetIds: Record<string, string>;
    };
    assertEquals(
      networkResult.Id,
      `/subscriptions/${options.SubscriptionID}/resourceGroups/${expectedResourceGroupName}/providers/Microsoft.Network/virtualNetworks/foundation-vnet`,
    );
    assertEquals(
      networkResult.SubnetIds['snet-app'],
      `${expectedResourceGroupName}/foundation-vnet/snet-app`,
    );
    assertEquals(
      networkResult.SubnetIds['snet-data'],
      `${expectedResourceGroupName}/foundation-vnet/snet-data`,
    );
  } finally {
    Deno.env.delete('DEV_USER');
  }
});
