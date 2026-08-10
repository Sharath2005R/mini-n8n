# System Architecture - AI Agent Workflow Builder (MVP)

This document provides a technical overview of the design and architecture of the AI Agent Workflow Builder.

## 1. Database Schema Design
We use PostgreSQL (hosted on Nhost Cloud) with UUID keys. The schema centers around strict workflow definition and audit-trail tracking:
*   `organizations` & `org_members`: Define organizational bounds. Users map to memberships with roles: `owner`, `editor`, or `viewer`.
*   `workflows`, `workflow_steps`, & `workflow_triggers`: Declare the workflow pipeline, sequential steps, and entry trigger points (e.g. manual, webhook).
*   `workflow_runs` & `step_runs`: Audit-trail tracking of executions, capturing inputs, outputs, errors, attempts, and approval gates.
*   `workflow_results`: Target table populated by the `db_write` step.
*   **Performance**: Explicit indexes are placed on all foreign keys (`org_id`, `workflow_id`, `workflow_run_id`, etc.) to optimize query speeds.

## 2. Security & Organization Isolation
Security is enforced at two distinct layers:
### Layer 1: Organization Isolation & Hasura Permissions
Hasura row-level permissions are evaluated using the authenticated user's ID (`X-Hasura-User-Id` header). 
We enforce that a user can only perform SELECT, INSERT, UPDATE, or DELETE if they belong to the corresponding organization. The authorization chain is verified via relationships:
*   `workflow.organization.members.user_id = X-Hasura-User-Id`
Even if a malicious user guesses a workflow UUID (`Org A`), the GraphQL Engine automatically filters out the record since they are not a member of `Org A`.

### Layer 2: Role and Step-Level Gating
*   **Hasura Row Checks**: Editors cannot insert or update step types to `db_write` or `notify`, nor create `webhook` triggers. This is restricted on the database via row-level permission constraints: `type` must not be in the restricted set unless the user's member role is `owner`.
*   **Action Handlers**: Crucial operations (like `approveStep` and `triggerWorkflowRun`) execute via serverless functions (Hasura Actions) where we perform authorization checks on the server using admin-level database context.

## 3. Why Approval Gating Authorization Lives in the Action Handler
The `approveStep` operation is implemented as a serverless Action handler because it encapsulates side-effect logic:
1.  **Strict Security Checking**: It queries the database using the session's authenticated user ID, verifying they are an Owner/Editor of that workflow's organization.
2.  **Audit Recording**: It writes audit parameters (`approved_by`, `approved_at`) directly to the `step_runs` table (which is set as write-protected from standard frontend calls).
3.  **Executor Resuming**: It triggers the asynchronous workflow execution starting from the subsequent step.
By holding this authorization logic inside the Action handler, we prevent clients from executing raw updates that bypass security gates.

## 4. Workflow Executor & Retries
The execution engine is a modular TypeScript class (`functions/shared/executor.ts`):
*   **Safe Expressions**: To route branches safely without security exploits, `conditional_branch` uses a pure data-driven condition evaluator comparing fields, operators (e.g., `equals`, `contains`), and target values. `eval()` is never used.
*   **HTTP Native Fetch**: External requests use the native Node `fetch` API.
*   **Automatic Retries**: External steps (`llm_call` and `http_request`) catch failures and retry exactly once. The attempt count is saved in the database.
*   **Exiting/Pausing**: When execution hits `approval_gate`, status is updated to `paused` and the Node process terminates. Upon approval, the Action handler triggers the executor with a `resumeFromStepId` flag, which skips all completed steps and continues immediately from the next step.

## 5. Quota Management
Organizations have strict quota boundaries (`quota_limit`). 
*   **At Start**: The executor checks if `quota_used >= quota_limit`. If exceeded, execution is immediately failed.
*   **Successful Completion**: To prevent fraud or waste, quota is only incremented *after* the workflow run finishes executing its final step successfully.

## 6. GraphQL Subscriptions & Webhooks
*   **Live Updates**: The Run Monitor page uses GraphQL Subscriptions. As the background executor updates tables in PostgreSQL, Hasura broadcasts these updates over WebSockets, updating the Next.js client layout immediately with 0 page refreshes.
*   **Webhooks**: External API calls hit `trigger-workflow-run` directly with a URL secret. The function validates the trigger's secret config before spinning up the executor.
