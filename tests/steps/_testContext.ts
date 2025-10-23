export type TestSecrets = {
  Get(key: string): Promise<string | undefined>;
  GetRequired(key: string): Promise<string>;
};

export type TestStepContext<TOptions, TServices, TSteps> = {
  Key: string;
  Config: Record<string, unknown>;
  EaC: Record<string, unknown>;
  DFSs: Record<string, unknown>;
  IoC: Record<string, unknown>;
  Secrets: TestSecrets;
  Services: TServices;
  Options?: TOptions;
  Steps?: TSteps;
};

export function createTestStepContext<
  TOptions extends Record<string, unknown> = Record<string, unknown>,
  TServices extends Record<string, unknown> = Record<string, unknown>,
  TSteps extends Record<string, unknown> = Record<string, unknown>,
>(overrides: {
  Key?: string;
  Options?: TOptions;
  Services?: TServices;
  Steps?: TSteps;
  Config?: Record<string, unknown>;
  EaC?: Record<string, unknown>;
} = {}): TestStepContext<TOptions, TServices, TSteps> {
  return {
    Key: overrides.Key ?? 'unit-test-step',
    Config: overrides.Config ?? {},
    EaC: overrides.EaC ?? { EnterpriseLookup: 'unit-test-workspace' },
    DFSs: {},
    IoC: {},
    Secrets: {
      Get: () => Promise.resolve(undefined),
      GetRequired: () => Promise.resolve(''),
    },
    Services: overrides.Services ?? {} as TServices,
    Options: overrides.Options,
    Steps: overrides.Steps,
  };
}
