// functions/approve-step.ts

import type { Request, Response } from 'express';
import { queryHasura } from './shared/client';
import { executeWorkflow } from './shared/executor';

const GET_STEP_RUN_FOR_APPROVAL = `
  query GetStepRunForApproval($stepRunId: uuid!, $userId: uuid!) {
    step_run: step_runs_by_pk(id: $stepRunId) {
      id
      status
      workflow_step_id
      workflow_step {
        id
        type
        workflow {
          id
          org_id
          organization {
            members(where: {user_id: {_eq: $userId}}) {
              role
            }
          }
        }
      }
      workflow_run {
        id
        status
      }
    }
  }
`;

const APPROVE_STEP_RUN = `
  mutation ApproveStepRun($stepRunId: uuid!, $userId: uuid!) {
    update_step_runs_by_pk(
      pk_columns: {id: $stepRunId},
      _set: {
        status: "completed",
        approved_by: $userId,
        approved_at: "now()",
        completed_at: "now()"
      }
    ) {
      id
      workflow_run_id
      workflow_step_id
    }
  }
`;

export default async function handler(req: Request, res: Response) {
  // Ensure POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const isHasuraAction = req.body && req.body.action && req.body.action.name === 'approveStep';
    if (!isHasuraAction) {
      return res.status(400).json({ success: false, message: 'Invalid action call' });
    }

    const { stepRunId } = req.body.input;
    const sessionVars = req.body.session_variables || {};
    const userId = sessionVars['x-hasura-user-id'];

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User session not found' });
    }

    if (!stepRunId) {
      return res.status(400).json({ success: false, message: 'Missing stepRunId parameter' });
    }

    // 1. Fetch step run details and authenticate user
    const resDetails = await queryHasura(GET_STEP_RUN_FOR_APPROVAL, { stepRunId, userId });
    const stepRun = resDetails.step_run;

    if (!stepRun) {
      return res.status(404).json({ success: false, message: 'Step run not found' });
    }

    // Verify user is member of organization
    const members = stepRun.workflow_step.workflow.organization?.members || [];
    if (members.length === 0) {
      return res.status(403).json({ success: false, message: 'Unauthorized. You do not belong to this organization.' });
    }

    // Verify role is owner or editor
    const role = members[0].role;
    if (role !== 'owner' && role !== 'editor') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Viewers cannot approve steps.' });
    }

    // Verify step type is approval_gate
    if (stepRun.workflow_step.type !== 'approval_gate') {
      return res.status(400).json({ success: false, message: 'This step is not an approval gate.' });
    }

    // Verify step run and workflow run are currently paused
    if (stepRun.status !== 'paused' || stepRun.workflow_run.status !== 'paused') {
      return res.status(400).json({
        success: false,
        message: `Cannot approve step. Step status is ${stepRun.status} and workflow status is ${stepRun.workflow_run.status} (expected paused).`
      });
    }

    // 2. Perform step approval updates
    const approveRes = await queryHasura(APPROVE_STEP_RUN, { stepRunId, userId });
    const { workflow_run_id: runId, workflow_step_id: stepId } = approveRes.update_step_runs_by_pk;

    // 3. Resume workflow in background starting from the step after this approval gate
    executeWorkflow(runId, stepId)
      .then(result => {
        console.log(`Resumed workflow execution for run ${runId} completed:`, result);
      })
      .catch(err => {
        console.error(`Resumed workflow execution for run ${runId} failed:`, err);
      });

    // 4. Return success response
    return res.status(200).json({
      success: true,
      message: 'Step approved and workflow resumed.',
      workflowRunId: runId,
      stepRunId: stepRunId,
      status: 'running'
    });

  } catch (error: any) {
    console.error('Approve step run error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}
