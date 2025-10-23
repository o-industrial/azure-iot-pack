import { assertEquals } from '../../tests.deps.ts';
import { createTestStepContext } from '../_testContext.ts';
import { AzureEnsureProvidersStep } from '../../../src/steps/landing-zone/AzureEnsureProvidersStep.ts';
import { AzureResolveCredentialInput } from '../../../src/steps/resolve-credential/AzureResolveCredentialInput.ts';

function buildRuntime() {
  const stepModule = AzureEnsureProvidersStep.Build();

  const credentialStrategy: AzureResolveCredentialInput = {
    Method: 'token',
    Token: 'fake-token',
  };

  const options = {
    SubscriptionID: 'sub-id',
    CredentialStrategy: credentialStrategy,
    DefaultProviders: ['Microsoft.Resources'],
  };

  const runtime = new stepModule.Step(options);

  return { runtime, options };
}

Deno.test('AzureEnsureProvidersStep registers missing providers and returns regions', async () => {
  const { runtime, options } = buildRuntime();

  let registrationState = 'NotRegistered';
  const registerCalls: string[] = [];

  const resourcesClient = {
    providers: {
      get: () => Promise.resolve({ registrationState }),
      register: (namespace: string) => {
        registerCalls.push(namespace);
        registrationState = 'Registered';
        return Promise.resolve();
      },
    },
    subscriptions: {
      listLocations: () =>
        Promise.resolve([
          { name: 'westus2', displayName: 'West US 2' },
          { name: undefined, displayName: 'ignored' },
        ]),
    },
  };

  const ctx = createTestStepContext<typeof options, { ResourcesClient: typeof resourcesClient }>({
    Options: options,
    Services: { ResourcesClient: resourcesClient },
  });

  const output = await runtime.Execute(
    {},
    ctx as unknown as Parameters<typeof runtime.Execute>[1],
  );

  assertEquals(registerCalls, options.DefaultProviders);
  assertEquals(output.Registered['Microsoft.Resources'], 'Registered');
  assertEquals(output.Regions, [
    { name: 'westus2', displayName: 'West US 2' },
  ]);
});

Deno.test('AzureEnsureProvidersStep respects explicit provider input without re-registering', async () => {
  const { runtime, options } = buildRuntime();

  const resourcesClient = {
    providers: {
      get: (namespace: string) =>
        Promise.resolve({
          registrationState: namespace === 'Microsoft.KeyVault' ? 'Registered' : 'NotRegistered',
        }),
      register: (_: string) => {
        throw new Error('register should not be called for already registered providers');
      },
    },
    subscriptions: {
      listLocations: () => Promise.resolve([]),
    },
  };

  const ctx = createTestStepContext<typeof options, { ResourcesClient: typeof resourcesClient }>({
    Options: options,
    Services: { ResourcesClient: resourcesClient },
  });

  const output = await runtime.Execute(
    {
      Providers: ['Microsoft.KeyVault'],
    },
    ctx as unknown as Parameters<typeof runtime.Execute>[1],
  );

  assertEquals(output.Registered['Microsoft.KeyVault'], 'Registered');
  assertEquals(output.Regions.length, 0);
});
