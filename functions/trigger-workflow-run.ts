// functions/trigger-workflow-run.ts

import type { Request, Response } from 'express';
import { queryHasura } from './shared/client';
import { executeWorkflow } from './shared/executor';

const CHECK_MANUAL_PERMISSION = `
  query CheckManualPermission($workflowId: uuid!, $userId: uuid!) {
    workflow: workflows_by_pk(id: $workflowId) {
      id
      org_id
      organization {
        quota_used
        quota_limit
        members(where: {user_id: {_eq: $userId}}) {
          role
        }
      }
    }
  }
`;

const CHECK_WEBHOOK_TRIGGER = `
  query CheckWebhookTrigger($workflowId: uuid!) {
    triggers: workflow_triggers(where: {
      workflow_id: {_eq: $workflowId},
      type: {_eq: "webhook"},
      enabled: {_eq: true}
    }) {
      id
      config
      workflow {
        id
        org_id
        organization {
          quota_used
          quota_limit
        }
      }
    }
  }
`;

const CREATE_WORKFLOW_RUN = `
  mutation CreateWorkflowRun($workflowId: uuid!, $triggerType: String!, $input: jsonb!) {
    insert_workflow_runs_one(object: {
      workflow_id: $workflowId,
      trigger_type: $triggerType,
      status: "pending",
      input: $input
    }) {
      id
    }
  }
`;

export default async function handler(req: Request, res: Response) {
  // Ensure POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const isHasuraAction = req.body && req.body.action && req.body.action.name === 'triggerWorkflowRun';
    
    let workflowId: string = '';
    let runInput: any = {};
    let isWebhook = false;
    let authError = '';
    let quotaLimit = 100;
    let quotaUsed = 0;

    if (isHasuraAction) {
      // 1. Manual run via Hasura Action
      workflowId = req.body.input.workflowId;
      runInput = req.body.input.input || {};
      const sessionVars = req.body.session_variables || {};
      const userId = sessionVars['x-hasura-user-id'];

      if (!userId) {
        return res.status(400).json({ success: false, message: 'User session not found' });
      }

      // Verify org membership and role
      const permRes = await queryHasura(CHECK_MANUAL_PERMISSION, { workflowId, userId });
      const workflow = permRes.workflow;

      if (!workflow) {
        return res.status(404).json({ success: false, message: 'Workflow not found' });
      }

      const members = workflow.organization?.members || [];
      if (members.length === 0) {
        return res.status(403).json({ success: false, message: 'Unauthorized. You do not belong to this organization.' });
      }

      const role = members[0].role;
      if (role !== 'owner' && role !== 'editor') {
        return res.status(403).json({ success: false, message: 'Unauthorized. Viewers cannot trigger runs.' });
      }

      quotaLimit = workflow.organization.quota_limit;
      quotaUsed = workflow.organization.quota_used;

    } else {
      // 2. External Webhook run
      isWebhook = true;
      workflowId = (req.query.workflowId as string) || req.headers['x-workflow-id'] as string || req.body.workflowId;
      const secret = (req.query.secret as string) || req.headers['x-webhook-secret'] as string || req.body.secret;
      
      // Extract webhook payload from body
      runInput = req.body;
      if (runInput && runInput.workflowId && runInput.secret) {
        // Strip secrets if they were passed in body
        const { workflowId: wId, secret: sec, ...bodyPayload } = runInput;
        runInput = bodyPayload;
      }

      if (!workflowId || !secret) {
        return res.status(400).json({ success: false, message: 'Missing workflowId or secret.' });
      }

      // Check webhook secret in workflow triggers config
      const triggerRes = await queryHasura(CHECK_WEBHOOK_TRIGGER, { workflowId });
      const triggers = triggerRes.triggers || [];
      
      let authorized = false;
      let orgDetails: any = null;

      for (const trig of triggers) {
        if (trig.config && trig.config.secret === secret) {
          authorized = true;
          orgDetails = trig.workflow.organization;
          break;
        }
      }

      if (!authorized || !orgDetails) {
        return res.status(403).json({ success: false, message: 'Unauthorized. Invalid workflow secret or trigger is disabled.' });
      }

      quotaLimit = orgDetails.quota_limit;
      quotaUsed = orgDetails.quota_used;
    }

    // 3. Verify Quota Limit
    if (quotaUsed >= quotaLimit) {
      return res.status(400).json({
        success: false,
        message: `Quota limit reached for this organization (${quotaUsed}/${quotaLimit}). Run rejected.`
      });
    }

    // 4. Create workflow run in pending state
    const triggerType = isWebhook ? 'webhook' : 'manual';
    const runRes = await queryHasura(CREATE_WORKFLOW_RUN, {
      workflowId,
      triggerType,
      input: runInput
    });
    const runId = runRes.insert_workflow_runs_one.id;

    // 5. Trigger executor asynchronously in background
    executeWorkflow(runId)
      .then(result => {
        console.log(`Async execution of run ${runId} finished. Status:`, result);
      })
      .catch(err => {
        console.error(`Async execution of run ${runId} threw an error:`, err);
      });

    // 6. Respond immediately to the client
    const responsePayload = {
      success: true,
      message: 'Workflow execution started successfully.',
      workflowRunId: runId,
      status: 'running'
    };

    return res.status(200).json(responsePayload);

  } catch (error: any) {
    console.error('Trigger workflow run error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}
