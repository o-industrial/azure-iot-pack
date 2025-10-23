import { assertEquals, assertMatch } from '../../tests.deps.ts';
import { createTestStepContext } from '../_testContext.ts';
import { shaHash } from '../../../src/.deps.ts';
import { AzureGovernanceAssignmentStep } from '../../../src/steps/landing-zone/AzureGovernanceAssignmentStep.ts';
import { AzureResolveCredentialInput } from '../../../src/steps/resolve-credential/AzureResolveCredentialInput.ts';

Deno.test('AzureGovernanceAssignmentStep creates policy and role assignments with deterministic identifiers', async () => {
  const stepModule = AzureGovernanceAssignmentStep.Build();

  const credentialStrategy: AzureResolveCredentialInput = {
    Method: 'token',
    Token: 'fake-token',
  };

  const options = {
    SubscriptionID: 'sub-id',
    CredentialStrategy: credentialStrategy,
  };

  const runtime = new stepModule.Step(options);

  const policyCalls: Array<{
    scope: string;
    assignmentName: string;
    payload: Record<string, unknown>;
  }> = [];

  const roleCalls: Array<{
    scope: string;
    assignmentId: string;
    payload: Record<string, unknown>;
  }> = [];

  const policyClient = {
    policyAssignments: {
      create: (
        scope: string,
        assignmentName: string,
        payload: Record<string, unknown>,
      ) => {
        policyCalls.push({ scope, assignmentName, payload });
        return Promise.resolve({
          id: `${scope}/providers/Microsoft.Authorization/policyAssignments/${assignmentName}`,
        });
      },
    },
  };

  const authorizationClient = {
    roleAssignments: {
      create: (
        scope: string,
        assignmentId: string,
        payload: Record<string, unknown>,
      ) => {
        roleCalls.push({ scope, assignmentId, payload });
        return Promise.resolve({
          id: `${scope}/providers/Microsoft.Authorization/roleAssignments/${assignmentId}`,
        });
      },
    },
  };

  const ctx = createTestStepContext<typeof options, {
    PolicyClient: typeof policyClient;
    AuthorizationClient: typeof authorizationClient;
  }>({
    Options: options,
    Services: {
      PolicyClient: policyClient,
      AuthorizationClient: authorizationClient,
    },
  });

  const scope = '/subscriptions/sub-id/resourceGroups/rg-test';
  const policyDefinitionId =
    '/providers/Microsoft.Authorization/policyDefinitions/allowed-locations';

  const input = {
    Scope: scope,
    PolicyDefinitions: [
      {
        Id: policyDefinitionId,
        Parameters: {
          listOfAllowedLocations: {
            value: ['westus2'],
          },
        },
      },
    ],
    RoleAssignments: [
      {
        RoleDefinitionId: '/providers/Microsoft.Authorization/roleDefinitions/reader',
        PrincipalId: '00000000-0000-0000-0000-000000000123',
      },
    ],
  };

  const result = await runtime.Execute(
    input,
    ctx as unknown as Parameters<typeof runtime.Execute>[1],
  );

  assertEquals(policyCalls.length, 1);
  const policyCall = policyCalls[0];
  const expectedPolicyHash = await shaHash(policyDefinitionId, 'policy');
  const expectedPolicyName = `policy-${expectedPolicyHash.substring(0, 24)}`;
  assertEquals(policyCall.assignmentName, expectedPolicyName);
  assertEquals(policyCall.payload.properties, {
    policyDefinitionId,
    parameters: input.PolicyDefinitions![0].Parameters,
    scope,
  });

  assertEquals(result.PolicyAssignmentIds, [
    `${scope}/providers/Microsoft.Authorization/policyAssignments/${expectedPolicyName}`,
  ]);

  assertEquals(roleCalls.length, 1);
  const roleCall = roleCalls[0];
  const expectedRoleHash = await shaHash(
    `${input.RoleAssignments![0].RoleDefinitionId}-${
      input.RoleAssignments![0].PrincipalId
    }-${scope}`,
    'role',
  );
  const expectedGuid = [
    expectedRoleHash.substring(0, 8),
    expectedRoleHash.substring(8, 12),
    expectedRoleHash.substring(12, 16),
    expectedRoleHash.substring(16, 20),
    expectedRoleHash.substring(20, 32),
  ].join('-');

  assertEquals(roleCall.assignmentId, expectedGuid);
  assertEquals(roleCall.payload.properties, {
    roleDefinitionId: input.RoleAssignments![0].RoleDefinitionId,
    principalId: input.RoleAssignments![0].PrincipalId,
    condition: undefined,
    conditionVersion: undefined,
  });

  assertEquals(result.RoleAssignmentIds, [
    `${scope}/providers/Microsoft.Authorization/roleAssignments/${expectedGuid}`,
  ]);

  assertMatch(expectedGuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
