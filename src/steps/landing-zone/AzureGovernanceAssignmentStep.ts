// @ts-nocheck - Azure SDK types require broader `any` usage until step scaffolding is refined
// deno-lint-ignore-file no-explicit-any
import { shaHash, Step, StepModuleBuilder, z } from '../../.deps.ts';
import { AzureResolveCredentialStep } from '../resolve-credential/AzureResolveCredentialStep.ts';
import {
  AzureResolveCredentialInputSchema,
} from '../resolve-credential/AzureResolveCredentialInput.ts';

import { PolicyClient } from 'npm:@azure/arm-policy@6.0.0';
import { AuthorizationManagementClient } from 'npm:@azure/arm-authorization@9.0.0';

// ---------- Input / Output ----------

export const AzureGovernanceAssignmentInputSchema: z.ZodObject<{
  Scope: z.ZodString;
  PolicyDefinitions?: z.ZodOptional<
    z.ZodArray<
      z.ZodObject<{
        Id: z.ZodString;
        Parameters?: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
      }>
    >
  >;
  RoleAssignments?: z.ZodOptional<
    z.ZodArray<
      z.ZodObject<{
        RoleDefinitionId: z.ZodString;
        PrincipalId: z.ZodString;
        Condition?: z.ZodOptional<z.ZodString>;
        ConditionVersion?: z.ZodOptional<z.ZodString>;
      }>
    >
  >;
}> = z.object({
  Scope: z.string(),
  PolicyDefinitions: z.array(
    z.object({
      Id: z.string(),
      Parameters: z.record(z.unknown()).optional(),
    }),
  ).optional(),
  RoleAssignments: z.array(
    z.object({
      RoleDefinitionId: z.string(),
      PrincipalId: z.string(),
      Condition: z.string().optional(),
      ConditionVersion: z.string().optional(),
    }),
  ).optional(),
});

export type AzureGovernanceAssignmentInput = z.infer<
  typeof AzureGovernanceAssignmentInputSchema
>;

export const AzureGovernanceAssignmentOutputSchema: z.ZodObject<{
  PolicyAssignmentIds: z.ZodArray<z.ZodString>;
  RoleAssignmentIds: z.ZodArray<z.ZodString>;
}> = z.object({
  PolicyAssignmentIds: z.array(z.string()),
  RoleAssignmentIds: z.array(z.string()),
});

export type AzureGovernanceAssignmentOutput = z.infer<
  typeof AzureGovernanceAssignmentOutputSchema
>;

// ---------- Options ----------

export const AzureGovernanceAssignmentOptionsSchema: z.ZodObject<{
  SubscriptionID: z.ZodString;
  CredentialStrategy: typeof AzureResolveCredentialInputSchema;
}> = z.object({
  SubscriptionID: z.string(),
  CredentialStrategy: AzureResolveCredentialInputSchema,
});

export type AzureGovernanceAssignmentOptions = z.infer<
  typeof AzureGovernanceAssignmentOptionsSchema
>;

// ---------- Step ----------

type TStepBuilder = StepModuleBuilder<
  AzureGovernanceAssignmentInput,
  AzureGovernanceAssignmentOutput,
  AzureGovernanceAssignmentOptions
>;

export const AzureGovernanceAssignmentStep: TStepBuilder = Step(
  'Azure Governance Assignment (SDK)',
  'Applies policy assignments and RBAC role assignments to the specified scope.',
)
  .Input(AzureGovernanceAssignmentInputSchema)
  .Output(AzureGovernanceAssignmentOutputSchema)
  .Options(AzureGovernanceAssignmentOptionsSchema)
  .Steps(() => ({
    ResolveCredential: AzureResolveCredentialStep.Build(),
  }))
  .Services((_input, ctx) => {
    const { CredentialStrategy, SubscriptionID } = ctx.Options!;

    const credential = {
      getToken: async () => {
        const { AccessToken } = await ctx.Steps!.ResolveCredential(
          CredentialStrategy,
        );

        return {
          token: AccessToken,
          expiresOnTimestamp: Date.now() + 3_600 * 1000,
        };
      },
    };

    const policyClient = new PolicyClient(
      credential as any,
      SubscriptionID,
    );
    const AuthorizationClient = new AuthorizationManagementClient(
      credential as any,
      SubscriptionID,
    );

    return { PolicyClient: policyClient, AuthorizationClient };
  })
  .Run(async (rawInput, rawCtx) => {
    const input = rawInput as AzureGovernanceAssignmentInput;
    const { PolicyClient, AuthorizationClient } = rawCtx.Services as {
      PolicyClient: PolicyClient;
      AuthorizationClient: AuthorizationManagementClient;
    };

    const { Scope, PolicyDefinitions, RoleAssignments } = input;

    const policyAssignmentIds: string[] = [];
    const roleAssignmentIds: string[] = [];

    if (PolicyDefinitions?.length) {
      for (const definition of PolicyDefinitions) {
        const hash = await shaHash(definition.Id, 'policy');
        const assignmentName = `policy-${hash.substring(0, 24)}`;

        const assignment = await PolicyClient.policyAssignments.create(
          Scope,
          assignmentName,
          {
            properties: {
              policyDefinitionId: definition.Id,
              parameters: definition.Parameters,
              scope: Scope,
            },
          },
        );

        if (assignment.id) {
          policyAssignmentIds.push(assignment.id);
        }
      }
    }

    if (RoleAssignments?.length) {
      for (const assignment of RoleAssignments) {
        // Role assignment names must be GUIDs.
        const hash = await shaHash(
          `${assignment.RoleDefinitionId}-${assignment.PrincipalId}-${Scope}`,
          'role',
        );
        const guid = [
          hash.substring(0, 8),
          hash.substring(8, 12),
          hash.substring(12, 16),
          hash.substring(16, 20),
          hash.substring(20, 32),
        ].join('-');

        const roleAssignment = await AuthorizationClient.roleAssignments
          .create(
            Scope,
            guid,
            {
              properties: {
                roleDefinitionId: assignment.RoleDefinitionId,
                principalId: assignment.PrincipalId,
                condition: assignment.Condition,
                conditionVersion: assignment.ConditionVersion,
              },
            },
          );

        if (roleAssignment.id) {
          roleAssignmentIds.push(roleAssignment.id);
        }
      }
    }

    return {
      PolicyAssignmentIds: policyAssignmentIds,
      RoleAssignmentIds: roleAssignmentIds,
    };
  }) as unknown as TStepBuilder;
