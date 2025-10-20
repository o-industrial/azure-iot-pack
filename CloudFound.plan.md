# Cloud Foundation SOP Expansion Plan

## Focus
- Translate the private cloud foundation blueprint into repeatable Azure automation inside `azure-iot-pack`.
- Reuse and extend existing step primitives so the SOP aligns with the marketing/runtime experience without duplicating orchestration logic.
- Deliver testable, documented SOP flows that the infra team can compose or override as new cloud regions and services come online.

## Success Criteria
- Foundation SOP covers subscription readiness, base landing zone provisioning, and governance hardening with reusable step modules.
- SOP orchestration runs locally against the dev subscription scaffold without manual step patching.
- Documentation enumerates each step, inputs, and expected outputs so other packs/runtime teams can consume the workflow.

## Milestones
- [ ] Milestone 1 – Baseline inventory and gaps captured (steps, SOP wiring, configuration requirements).
- [ ] Milestone 2 – New/updated reusable steps authored with unit coverage.
- [ ] Milestone 3 – Cloud foundation SOP assembled and validated end-to-end.
- [ ] Milestone 4 – Docs/playbooks published and hand-off accepted by infra + runtime teams.

## Workstreams

### 1. Baseline Audit & Gap Analysis
- [x] Catalogue existing Azure landing zone related steps under `src/steps/**` (Container Apps, resource group helpers, networking) and tag what can be reused.
- [x] Identify missing primitives for the foundation blueprint (provider registration, policy assignment, diagnostics wiring, Key Vault bootstrap, Log Analytics).
- [x] Capture dependencies (Secrets API, cloud connections, MSAL auth) that SOP must assume or prepare.
- Deliverable: annotated inventory table checked into this plan.

#### Current Step Inventory
| Step Module | File | Category | Reuse Potential | Notes / Follow-ups |
| --- | --- | --- | --- | --- |
| `AzureResolveCredentialStep` | `src/steps/resolve-credential/AzureResolveCredentialStep.ts` | Authentication | ✅ Core dependency | Wraps credential strategies already used by CALZ step. Confirm Secrets/Cloud Connection wiring for SOP invocation. |
| `WorkspaceEnsureAzureResourceGroupStep` | `src/steps/calz/WorkspaceEnsureAzureResourceGroupStep.ts` | Resource Group | ⚠️ Needs enhancement | Hardcodes `westus2`, hashes workspace lookup, and returns only RG name. Must accept dynamic region/inputs and expose location, tags, IDs. |
| `AzureContainerApp*` steps | `src/steps/container-apps/*.ts` | Workload Runtime | ➖ Not foundation-critical | Lifecycle helpers for Container Apps workloads. Keep as-is; note dependency on foundation networking once available. |
| `AzureIoTHub*` steps | `src/steps/iot/*.ts` | IoT Enablement | ➖ Not foundation-critical | Device provisioning/statistics logic. Useful reference for diagnostics patterns but outside base foundation scope. |

No existing steps handle provider registration, policy assignment, Key Vault, Log Analytics, or diagnostics wiring.

#### Missing Primitives (Detailed)
- **Provider & Region Readiness Step** – Registers required Azure resource providers and returns available regions for the subscription.
- **Landing Zone Scaffolding Step** – Extends the CALZ RG helper to support configurable region, naming, tagging, virtual network creation, and subnet layout.
- **Key Vault Bootstrap Step** – Creates/ensures a Key Vault, applies access policies, and outputs vault metadata.
- **Log Analytics Workspace Step** – Provisions a workspace aligned to the landing zone naming convention, configures retention, and returns identifiers/shared key.
- **Diagnostics Wiring Step** – Applies diagnostic settings for core services targeting Log Analytics (and future storage/event hub options).
- **Policy & RBAC Assignment Step** – Applies baseline Azure Policy definitions and role assignments with idempotent behavior.

#### Dependencies to Validate
- `AzureResolveCredentialStep` requires a `CredentialStrategy`; SOP must ensure Secrets service or workspace cloud connection supplies the necessary values/tokens.
- `OPEN_INDUSTRIAL_RESOURCE_GROUP_ROOT` environment variable is used by the existing CALZ step. Decide whether to keep, rename, or replace with plan-driven naming convention.
- SOP assumes a workspace cloud connection (MSAL/ADB2C) already exists so subscription, tenant, and client IDs are resolvable at runtime.
- Need clarity on Secrets API usage for storing generated credentials (Key Vault admin, diagnostic storage keys).
- Confirm logging/telemetry pipeline expectations so SOP can emit activity data consumed by runtime UI.

### 2. Reusable Step Authoring
- [x] Design step contracts (inputs/outputs) for each missing capability and document them in this plan before coding.
- [x] Implement provider/region readiness step leveraging existing Azure SDK wrappers if available.
- [x] Implement landing zone resource group + network step with idempotent tagging and naming alignment.
- [x] Implement security & observability steps (Key Vault seeding, Log Analytics workspace linking, policy/RBAC application).
- [ ] Add unit tests in `tests/steps/**` for every new step, including failure-path assertions.
- Deliverable: new or updated modules under `src/steps/landing-zone/**` (or agreed folder) plus tests.

#### Proposed Step Contracts
- **Provider & Region Readiness Step** (`AzureEnsureProvidersStep`)  
  - Input: `{ Providers?: string[] }`  
  - Options: `{ SubscriptionID, CredentialStrategy, DefaultProviders }`  
  - Output: `{ Registered: Record<string, string>; Regions: Array<{ name: string; displayName?: string }> }`
- **Landing Zone Foundation Step** (`AzureLandingZoneFoundationStep`)  
  - Input: `{ WorkspaceLookup?, ResourceGroup { Name?, Location, Tags? }, Network? }`  
  - Options: `{ SubscriptionID, CredentialStrategy, ResourceGroupRoot?, DefaultTags? }`  
  - Output: `{ ResourceGroup { Name, Id, Location }, Network?: { Id, SubnetIds: Record<string, string> } }`
- **Key Vault Bootstrap Step** (`AzureKeyVaultBootstrapStep`)  
  - Input: `{ VaultName, Location, ResourceGroupName, AccessPolicies?, Tags? }`  
  - Options: `{ SubscriptionID, CredentialStrategy, TenantId }`  
  - Output: `{ VaultId, VaultUri }`
- **Log Analytics Workspace Step** (`AzureLogAnalyticsWorkspaceStep`)  
  - Input: `{ WorkspaceName, Location, ResourceGroupName, RetentionInDays?, Tags? }`  
  - Options: `{ SubscriptionID, CredentialStrategy, RetrieveSharedKeys? }`  
  - Output: `{ WorkspaceId, CustomerId, PrimarySharedKey? }`
- **Diagnostics Wiring Step** (`AzureDiagnosticsWiringStep`)  
  - Input: `{ WorkspaceResourceId, Targets: Array<{ ResourceId, Logs?, Metrics? }> }`  
  - Options: `{ SubscriptionID, CredentialStrategy }`  
  - Output: `{ Applied: Array<{ ResourceId, SettingName }> }`
- **Policy & RBAC Assignment Step** (`AzureGovernanceAssignmentStep`)  
  - Input: `{ Scope, PolicyDefinitions?, RoleAssignments? }`  
  - Options: `{ SubscriptionID, CredentialStrategy }`  
  - Output: `{ PolicyAssignmentIds: string[], RoleAssignmentIds: string[] }`

Each step wraps `AzureResolveCredentialStep` for token acquisition and exposes schemas via `zod` for consistency with existing packs.

#### Implementation Notes
- `AzureEnsureProvidersStep` added under `src/steps/landing-zone/` to register providers and surface subscription regions.
- `AzureLandingZoneFoundationStep` added to provision the resource group, apply tags, and optionally create a virtual network/subnets.
- `AzureKeyVaultBootstrapStep`, `AzureLogAnalyticsWorkspaceStep`, `AzureDiagnosticsWiringStep`, and `AzureGovernanceAssignmentStep` added to cover vault creation, workspace provisioning, diagnostics wiring, and policy/RBAC assignments respectively.

### 3. SOP Composition & Validation
- [ ] Draft the cloud foundation SOP in `src/sop/CloudFoundation.ts` (or equivalent) wiring steps with clear sequencing and guardrails.
- [ ] Introduce feature flags or configuration to choose between quickstart vs hardened deployment paths.
- [ ] Run end-to-end dry runs against the dev subscription sandbox; log outcomes and follow-up tasks in this plan.
- [ ] Capture success/failure telemetry expectations so runtime UIs can surface progress.
- Deliverable: runnable SOP script + validation notes.

### 4. Documentation & Enablement
- [ ] Update `README.md` (and/or `docs/`) with overview of the Cloud Foundation SOP, prerequisites, and how to invoke it.
- [ ] Produce step catalogue appendix (inputs, outputs, side effects) for infra/operators.
- [ ] Coordinate with runtime teams to ensure modal messaging and SOP outputs share terminology.
- [ ] Plan follow-up backlog (region expansion, policy packs, automated rollbacks) and track as future work items.

## Open Questions / Dependencies
- Which subscription(s) and resource groups can we target for automated tests?
- Do we need to integrate with a secrets/approval service before policy enforcement runs?
- Are there shared tagging/naming conventions we must import from another pack?

## Status Log
- 2025-10-?? – Plan created; awaiting inventory of existing steps.
