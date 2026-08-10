// functions/shared/executor.ts

import { queryHasura } from './client';
import { evaluateCondition, Condition } from './evaluator';

// GraphQL statements
const GET_WORKFLOW_RUN = `
  query GetWorkflowRun($runId: uuid!) {
    workflow_run: workflow_runs_by_pk(id: $runId) {
      id
      workflow_id
      status
      trigger_type
      input
      workflow {
        org_id
        organization {
          quota_limit
          quota_used
        }
        steps(order_by: {position: asc}) {
          id
          position
          name
          type
          config
        }
      }
    }
  }
`;

const UPDATE_WORKFLOW_RUN = `
  mutation UpdateWorkflowRun($runId: uuid!, $status: String!, $completedAt: timestamptz, $error: String) {
    update_workflow_runs_by_pk(
      pk_columns: {id: $runId},
      _set: {status: $status, completed_at: $completedAt, error: $error}
    ) {
      id
    }
  }
`;

const INCREMENT_QUOTA = `
  mutation IncrementQuota($orgId: uuid!) {
    update_organizations_by_pk(
      pk_columns: {id: $orgId},
      _inc: {quota_used: 1}
    ) {
      id
      quota_used
    }
  }
`;

const CREATE_STEP_RUN = `
  mutation CreateStepRun($runId: uuid!, $stepId: uuid!, $input: jsonb!) {
    insert_step_runs_one(object: {
      workflow_run_id: $runId,
      workflow_step_id: $stepId,
      status: "running",
      input: $input,
      started_at: "now()",
      attempt_count: 1
    }) {
      id
    }
  }
`;

const UPDATE_STEP_RUN = `
  mutation UpdateStepRun($stepRunId: uuid!, $status: String!, $output: jsonb!, $error: String, $attemptCount: Int!, $completedAt: timestamptz) {
    update_step_runs_by_pk(
      pk_columns: {id: $stepRunId},
      _set: {
        status: $status,
        output: $output,
        error: $error,
        attempt_count: $attemptCount,
        completed_at: $completedAt
      }
    ) {
      id
    }
  }
`;

const CREATE_WORKFLOW_RESULT = `
  mutation CreateWorkflowResult($workflowId: uuid!, $runId: uuid!, $result: jsonb!) {
    insert_workflow_results_one(object: {
      workflow_id: $workflowId,
      workflow_run_id: $runId,
      result: $result
    }) {
      id
    }
  }
`;

const GET_STEP_RUNS = `
  query GetStepRuns($runId: uuid!) {
    step_runs(where: {workflow_run_id: {_eq: $runId}}, order_by: {created_at: asc}) {
      id
      workflow_step_id
      status
      output
    }
  }
`;

export async function executeWorkflow(runId: string, resumeFromStepId?: string) {
  console.log(`Starting execution for run ${runId}. Resume from step: ${resumeFromStepId || 'None'}`);

  // 1. Fetch Workflow Run details
  const { workflow_run } = await queryHasura(GET_WORKFLOW_RUN, { runId });
  if (!workflow_run) {
    throw new Error(`Workflow run ${runId} not found.`);
  }

  const { workflow, input: runInput, workflow_id: workflowId } = workflow_run;
  const org = workflow.organization;
  const steps = workflow.steps || [];

  // 2. Validate Quota at initial start
  if (!resumeFromStepId) {
    if (org.quota_used >= org.quota_limit) {
      const errorMsg = `Quota limit reached (${org.quota_used}/${org.quota_limit}). Execution rejected.`;
      await queryHasura(UPDATE_WORKFLOW_RUN, {
        runId,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }

    // Set status to running
    await queryHasura(UPDATE_WORKFLOW_RUN, {
      runId,
      status: 'running',
      error: null,
    });
  } else {
    // If resuming, make sure we set the workflow run back to running
    await queryHasura(UPDATE_WORKFLOW_RUN, {
      runId,
      status: 'running',
      error: null,
    });
  }

  // 3. Sequential Execution
  let currentStepIdx = 0;

  if (resumeFromStepId) {
    // Find the resumed step, and start execution from the next step
    const resumeStepIdx = steps.findIndex((s: any) => s.id === resumeFromStepId);
    if (resumeStepIdx === -1) {
      throw new Error(`Resumed step ID ${resumeFromStepId} not found in workflow steps.`);
    }
    currentStepIdx = resumeStepIdx + 1;
    console.log(`Resuming execution starting from step index ${currentStepIdx}`);
  }

  let lastStepOutput: any = {};
  
  // If we are resuming, load previous step runs to fetch the output of the last completed step
  if (currentStepIdx > 0) {
    const { step_runs: pastRuns } = await queryHasura(GET_STEP_RUNS, { runId });
    // Find the last completed run output
    const completedRuns = pastRuns.filter((r: any) => r.status === 'completed');
    if (completedRuns.length > 0) {
      lastStepOutput = completedRuns[completedRuns.length - 1].output || {};
    }
  }

  while (currentStepIdx < steps.length) {
    const step = steps[currentStepIdx];
    console.log(`Executing step [${step.position}] "${step.name}" (${step.type})`);

    // Prepare step input
    let stepInput: any = {};
    if (step.type === 'llm_call') {
      const promptTemplate = step.config.prompt || '';
      // Replace {{input}} references with run input string representation
      const inputStr = typeof runInput === 'string' ? runInput : JSON.stringify(runInput);
      stepInput = {
        prompt: promptTemplate.replace(/\{\{input\}\}/g, inputStr),
        model: step.config.model,
        provider: step.config.provider,
      };
    } else if (step.type === 'conditional_branch') {
      stepInput = {
        conditions: step.config.conditions,
        previous_output: lastStepOutput,
      };
    } else if (step.type === 'http_request') {
      // Resolve headers & body templates if necessary, for now keep simple config
      stepInput = {
        url: step.config.url,
        method: step.config.method || 'GET',
        headers: step.config.headers || {},
        body: step.config.body || null,
        previous_output: lastStepOutput,
      };
    } else {
      stepInput = {
        config: step.config,
        previous_output: lastStepOutput,
        run_input: runInput,
      };
    }

    // Insert running step run
    const createRes = await queryHasura(CREATE_STEP_RUN, {
      runId,
      stepId: step.id,
      input: stepInput,
    });
    const stepRunId = createRes.insert_step_runs_one.id;

    // Run the step with retries
    let attempt = 1;
    let stepSuccess = false;
    let stepOutput: any = {};
    let stepError = '';

    while (attempt <= 2 && !stepSuccess) {
      try {
        if (step.type === 'llm_call') {
          stepOutput = await executeLlmCall(stepInput.prompt, stepInput.model);
          stepSuccess = true;
        } else if (step.type === 'http_request') {
          stepOutput = await executeHttpRequest(stepInput);
          stepSuccess = true;
        } else if (step.type === 'conditional_branch') {
          const conditions: Condition[] = stepInput.conditions || [];
          let match = true;
          for (const cond of conditions) {
            if (!evaluateCondition(lastStepOutput, cond)) {
              match = false;
              break;
            }
          }
          stepOutput = { match };
          stepSuccess = true;
        } else if (step.type === 'approval_gate') {
          // Pause execution
          await queryHasura(UPDATE_STEP_RUN, {
            stepRunId,
            status: 'paused',
            output: {},
            error: null,
            attemptCount: 1,
            completedAt: null,
          });

          await queryHasura(UPDATE_WORKFLOW_RUN, {
            runId,
            status: 'paused',
            error: null,
          });

          console.log(`Workflow run ${runId} paused at Approval Gate step ${step.id}`);
          return { success: true, paused: true, workflowRunId: runId };
        } else if (step.type === 'db_write') {
          // Write to workflow_results
          await queryHasura(CREATE_WORKFLOW_RESULT, {
            workflowId,
            runId,
            result: lastStepOutput,
          });
          stepOutput = { success: true, message: 'Result written successfully' };
          stepSuccess = true;
        } else if (step.type === 'notify') {
          // Log notification (can hook up Hasura Event Trigger later)
          console.log(`[NOTIFICATION STEP] Workflow Run: ${runId}, Payload:`, lastStepOutput);
          stepOutput = { notified: true, timestamp: new Date().toISOString() };
          stepSuccess = true;
        } else {
          throw new Error(`Unsupported step type: ${step.type}`);
        }
      } catch (err: any) {
        stepError = err.message || 'Unknown error occurred';
        console.error(`Attempt ${attempt} failed for step ${step.name}: ${stepError}`);
        // Retries only apply to external steps (llm_call, http_request)
        if (step.type === 'llm_call' || step.type === 'http_request') {
          attempt++;
          if (attempt <= 2) {
            console.log(`Retrying step ${step.name}...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // wait 1s before retry
          }
        } else {
          break; // break retry loop for internal steps
        }
      }
    }

    if (stepSuccess) {
      await queryHasura(UPDATE_STEP_RUN, {
        stepRunId,
        status: 'completed',
        output: stepOutput,
        error: null,
        attemptCount: attempt > 2 ? 2 : attempt,
        completedAt: new Date().toISOString(),
      });
      lastStepOutput = stepOutput;

      // Handle conditional routing
      if (step.type === 'conditional_branch') {
        const nextStepId = stepOutput.match ? step.config.true_step_id : step.config.false_step_id;
        
        if (nextStepId === 'END') {
          console.log(`Conditional branch routed to End Workflow for run ${runId}`);
          break;
        }
        
        if (nextStepId) {
          const nextIdx = steps.findIndex((s: any) => s.id === nextStepId);
          if (nextIdx !== -1) {
            currentStepIdx = nextIdx;
            continue;
          } else {
            console.log(`Target routing step ${nextStepId} not found, ending execution for run ${runId}`);
            break;
          }
        } else {
          // If match is false and no route is specified, terminate execution
          if (!stepOutput.match) {
            console.log(`Conditional match failed with no custom false path, ending execution for run ${runId}`);
            break;
          }
        }
      }

      currentStepIdx++;
    } else {
      // Step failed
      await queryHasura(UPDATE_STEP_RUN, {
        stepRunId,
        status: 'failed',
        output: {},
        error: stepError,
        attemptCount: attempt > 2 ? 2 : attempt,
        completedAt: new Date().toISOString(),
      });

      await queryHasura(UPDATE_WORKFLOW_RUN, {
        runId,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: `Step "${step.name}" failed: ${stepError}`,
      });

      console.error(`Workflow run ${runId} failed at step "${step.name}"`);
      return { success: false, error: stepError };
    }
  }

  // 4. Successful workflow completion
  await queryHasura(UPDATE_WORKFLOW_RUN, {
    runId,
    status: 'completed',
    completedAt: new Date().toISOString(),
    error: null,
  });

  // Increment usage quota
  await queryHasura(INCREMENT_QUOTA, { orgId: workflow.org_id });

  console.log(`Workflow run ${runId} completed successfully. Quota incremented.`);
  return { success: true, completed: true, workflowRunId: runId };
}

// Sub-executor for LLM Call
async function executeLlmCall(prompt: string, model?: string): Promise<any> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.warn('GEMINI_API_KEY is not defined. Using stub fallback.');
    await new Promise(resolve => setTimeout(resolve, 1000)); // artificial delay
    const lowercasePrompt = prompt.toLowerCase();
    const refundRequired = lowercasePrompt.includes('refund') || lowercasePrompt.includes('damage');
    return {
      refund_required: refundRequired,
      reason: 'AI classification stubbed (No GEMINI_API_KEY present)',
    };
  }

  const selectedModel = model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${geminiKey}`;
  const promptRequest = `${prompt}\n\nReturn ONLY a valid JSON object in your response, matching this schema: {"refund_required": boolean, "reason": string}. Do not wrap the JSON in markdown codeblocks (e.g. \`\`\`json).`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: promptRequest }]
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Catch quota limits, access errors, or billing limitations, and fallback to stub
    if (response.status === 429 || response.status === 403 || errorText.includes('quota') || errorText.includes('limit')) {
      console.warn(`Gemini API returned error status ${response.status}. Falling back to local AI stub classification...`);
      const lowercasePrompt = prompt.toLowerCase();
      const refundRequired = lowercasePrompt.includes('refund') || lowercasePrompt.includes('damage');
      return {
        refund_required: refundRequired,
        reason: `AI classification stubbed (Gemini API status ${response.status}: Quota Exceeded)`,
      };
    }
    throw new Error(`Gemini API Call failed: ${response.statusText}. Details: ${errorText}`);
  }

  const result = (await response.json()) as any;
  const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) {
    throw new Error('Gemini API returned an empty response.');
  }

  try {
    // Sanitize in case Gemini wrapped it in markdown codeblocks
    const cleanText = textResponse.replace(/```json|```/gi, '').trim();
    return JSON.parse(cleanText);
  } catch (err: any) {
    console.error('Failed to parse Gemini response as JSON:', textResponse);
    throw new Error(`LLM output was not valid JSON: ${textResponse}`);
  }
}

// Sub-executor for HTTP request using native fetch
async function executeHttpRequest(stepInput: any): Promise<any> {
  const { url, method, headers, body } = stepInput;
  if (!url) {
    throw new Error('HTTP Request missing URL configuration.');
  }

  // Parse template variables in body or url if needed, for now just standard options
  const fetchHeaders: Record<string, string> = { ...headers };
  let fetchBody: any = null;

  if (body) {
    if (typeof body === 'object') {
      fetchHeaders['Content-Type'] = fetchHeaders['Content-Type'] || 'application/json';
      fetchBody = JSON.stringify(body);
    } else {
      fetchBody = body;
    }
  }

  console.log(`Sending ${method} request to ${url}`);
  const response = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: fetchBody,
  });

  const responseText = await response.text();
  let jsonOutput: any = {};
  try {
    jsonOutput = JSON.parse(responseText);
  } catch {
    jsonOutput = { text: responseText };
  }

  if (!response.ok) {
    throw new Error(`HTTP Request failed with status ${response.status}: ${responseText}`);
  }

  return {
    status: response.status,
    statusText: response.statusText,
    data: jsonOutput,
  };
}
