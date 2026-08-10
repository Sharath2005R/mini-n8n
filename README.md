# AI Agent Workflow Builder (MVP)

A mini n8n-style workflow automation engine built for chaining AI agent steps with robust cross-organization isolation, role-based permissions, usage quotas, and live subscription monitoring.

## Tech Stack
*   **Frontend**: Next.js 14+ (React 19, TypeScript, App Router, Vanilla CSS)
*   **Backend & DB**: Nhost Cloud (PostgreSQL, Hasura GraphQL Engine, Nhost Auth, Nhost Functions)
*   **GraphQL Client**: Apollo Client (supporting WebSocket Subscriptions and authenticated headers)

---

## Folder Structure

```
.
├── nhost/                          # Nhost configuration and Hasura settings
│   ├── nhost.toml                 # Nhost central config
│   ├── metadata/                   # Hasura metadata (permissions, relationships, actions)
│   └── migrations/                 # PostgreSQL migrations (schema tables, indexes)
├── functions/                      # Serverless Functions (deploys to Nhost Cloud)
│   ├── approve-step.ts             # Handles step run approval
│   ├── trigger-workflow-run.ts     # Triggers a manual run or webhook run
│   ├── notification.ts             # Hasura Event Trigger logging notification payload
│   └── shared/                     # Shared executor and evaluator modules
├── web/                            # Next.js Frontend Application
│   ├── src/app/                    # App Router pages (Dashboard, builder, monitor)
│   └── src/components/             # UI Components (NhostApolloProvider, etc.)
├── scripts/                        # Development helpers
│   └── functions-runner.ts         # Express server to run functions locally
└── package.json                    # Workspace monorepo config
```

---

## Local Setup & Configuration

### Prerequisites
*   Node.js (v18+)
*   NPM (v10+)

### 1. Installation
Install dependencies in the root folder and frontend folder:
```bash
# Install root workspace modules (for serverless development)
npm install

# Install Next.js frontend modules
cd web
npm install --legacy-peer-deps
```

### 2. Environment Variables Setup
Create a `.env` file in the root directory by copying the template:
```bash
cp .env.example .env
```
Fill in the values with your Nhost Cloud credentials and Gemini API Key:
*   `NHOST_BACKEND_URL`: `https://[subdomain].nhost.run`
*   `NHOST_GRAPHQL_URL`: `https://[subdomain].graphql.[region].nhost.run/v1/graphql`
*   `NHOST_ADMIN_SECRET`: Hasura admin secret from your Nhost dashboard.
*   `GEMINI_API_KEY`: Google Gemini API Key. (If left empty, a mock AI classification stub is used).

Create a `.env.local` file inside the `web/` directory:
```bash
# web/.env.local
NEXT_PUBLIC_NHOST_SUBDOMAIN=your-subdomain
NEXT_PUBLIC_NHOST_REGION=your-region
```

### 3. Deploy Database and Metadata
If you connect your GitHub repository to Nhost Cloud, Nhost will automatically apply the migrations and metadata from `nhost/`.
Alternatively, you can apply them using the Hasura CLI:
```bash
# Inside nhost/
hasura metadata apply --endpoint https://[subdomain].graphql.[region].nhost.run/v1/graphql --admin-secret [your-secret]
hasura migrations apply --endpoint https://[subdomain].graphql.[region].nhost.run/v1/graphql --admin-secret [your-secret]
```

### 4. Running the Project Locally
To run the serverless functions runner and the Next.js app concurrently:

```bash
# 1. Start the Serverless Functions local runner (listens on port 5001)
npm run dev:functions

# 2. In a separate terminal, start the Next.js development server
npm run web:dev
```
Open `http://localhost:3000` in your browser.

---

## Testing & Verification Checklist

### 1. Cross-Organization Isolation
*   Create two organizations in Nhost: `Org A` and `Org B`.
*   Log in as `User A` (Owner of `Org A`) and create a workflow. Note its UUID.
*   Log in as `User B` (Owner of `Org B`). Try to query the workflow UUID or execute a run.
*   **Result**: The request is blocked by Hasura permissions (returns empty/error) proving isolation.

### 2. Role-Based Permissions
*   `Owner`: Full CRUD on workflows, steps, and org members.
*   `Editor`: Read workflows, edit normal steps, run manual trigger. Restricting `db_write` and `notify` step types.
*   `Viewer`: Read-only. Cannot trigger executions or edit steps.

### 3. Execution Run Verification
*   Create the Customer Refund workflow:
    1.  `llm_call` (AI Classifier classifying input query)
    2.  `http_request` (External API link validation)
    3.  `conditional_branch` (Evaluates `refund_required == true`)
    4.  `approval_gate` (Manager manual check)
    5.  `db_write` (Save output to `workflow_results`)
*   Provide input: `{"text": "My package arrived damaged and I want a refund."}`
*   Click **Run**. The live monitor should show:
    *   `llm_call` -> `completed`
    *   `http_request` -> `completed`
    *   `conditional` -> `completed`
    *   `approval_gate` -> `paused / awaiting approval`
*   Log in as `Owner`/`Editor`, click **Approve Step Run**.
*   Execution resumes, writes to results, and finishes. Quota increments by 1.
