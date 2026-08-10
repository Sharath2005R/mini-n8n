// functions/external-approve.ts
import type { Request, Response } from 'express';
import { queryHasura } from './shared/client';
import { executeWorkflow } from './shared/executor';

const GET_STEP_RUN_SIMPLE = `
  query GetStepRunSimple($stepRunId: uuid!) {
    step_run: step_runs_by_pk(id: $stepRunId) {
      id
      status
      workflow_step_id
      workflow_run {
        id
        status
        workflow {
          id
          name
        }
      }
    }
  }
`;

const APPROVE_STEP_RUN_SIMPLE = `
  mutation ApproveStepRunSimple($stepRunId: uuid!) {
    update_step_runs_by_pk(
      pk_columns: {id: $stepRunId},
      _set: {
        status: "completed",
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

const REJECT_STEP_RUN_SIMPLE = `
  mutation RejectStepRunSimple($stepRunId: uuid!, $runId: uuid!, $errorMsg: String!) {
    update_step_runs_by_pk(
      pk_columns: {id: $stepRunId},
      _set: {
        status: "failed",
        error: $errorMsg,
        completed_at: "now()"
      }
    ) {
      id
    }
    update_workflow_runs_by_pk(
      pk_columns: {id: $runId},
      _set: {
        status: "failed",
        error: $errorMsg,
        completed_at: "now()"
      }
    ) {
      id
    }
  }
`;

function renderHtmlPage(title: string, message: string, success: boolean, color = '#eab308') {
  const finalColor = success ? (color === '#eab308' ? '#10b981' : color) : '#ef4444';
  const finalIcon = success ? (color === '#ef4444' ? '✖' : '✔') : '⚠';
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} | mini-n8n</title>
      <style>
        body {
          background-color: #0b0f19;
          color: #f3f4f6;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
        }
        .container {
          background: rgba(17, 24, 39, 0.7);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 40px;
          text-align: center;
          max-width: 500px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        }
        .icon {
          font-size: 48px;
          color: ${finalColor};
          margin-bottom: 24px;
        }
        h1 {
          font-size: 24px;
          font-weight: 700;
          margin: 0 0 16px 0;
          letter-spacing: -0.025em;
        }
        p {
          font-size: 15px;
          color: #9ca3af;
          line-height: 1.6;
          margin: 0 0 24px 0;
        }
        .footer {
          font-size: 12px;
          color: #6b7280;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 16px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">${finalIcon}</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="footer">
          mini-n8n Serverless Functions Execution Portal
        </div>
      </div>
    </body>
    </html>
  `;
}

export default async function handler(req: Request, res: Response) {
  const stepRunId = req.query.stepRunId as string;
  const action = req.query.action as string;

  if (!stepRunId) {
    return res.status(400).send(renderHtmlPage('Error', 'Missing stepRunId parameter', false));
  }

  try {
    // 1. Fetch step run details
    const resDetails = await queryHasura(GET_STEP_RUN_SIMPLE, { stepRunId });
    const stepRun = resDetails.step_run;

    if (!stepRun) {
      return res.status(404).send(renderHtmlPage('Not Found', 'Step run not found', false));
    }

    // Verify step status is paused
    if (stepRun.status !== 'paused' || stepRun.workflow_run.status !== 'paused') {
      return res.status(400).send(renderHtmlPage(
        'Action Unavailable', 
        `This step has already been processed (status is ${stepRun.status}, workflow run is ${stepRun.workflow_run.status}).`,
        false
      ));
    }

    const runId = stepRun.workflow_run.id;
    const stepId = stepRun.workflow_step_id;
    const workflowName = stepRun.workflow_run.workflow.name;

    if (action === 'approve') {
      // 2. Perform step approval updates
      await queryHasura(APPROVE_STEP_RUN_SIMPLE, { stepRunId });

      // 3. Resume workflow in background starting from the step after this approval gate
      executeWorkflow(runId, stepId)
        .then(result => {
          console.log(`Resumed workflow execution for run ${runId} completed:`, result);
        })
        .catch(err => {
          console.error(`Resumed workflow execution for run ${runId} failed:`, err);
        });

      return res.status(200).send(renderHtmlPage(
        'Execution Approved', 
        `The Approval Gate for workflow <strong>"${workflowName}"</strong> has been approved. The execution has resumed.`,
        true
      ));
    } else if (action === 'reject') {
      // 2. Perform step rejection updates
      await queryHasura(REJECT_STEP_RUN_SIMPLE, { 
        stepRunId, 
        runId, 
        errorMsg: 'Rejected by reviewer via external link.' 
      });

      return res.status(200).send(renderHtmlPage(
        'Execution Rejected', 
        `The Approval Gate for workflow <strong>"${workflowName}"</strong> has been rejected. The execution has terminated.`,
        true,
        '#ef4444'
      ));
    } else {
      return res.status(400).send(renderHtmlPage('Error', 'Invalid action query parameter. Must be "approve" or "reject".', false));
    }

  } catch (error: any) {
    console.error('External approve step run error:', error);
    return res.status(500).send(renderHtmlPage('Internal Server Error', error.message || 'An error occurred.', false));
  }
}
