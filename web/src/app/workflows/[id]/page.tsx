// web/src/app/workflows/[id]/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthenticationStatus, useUserData } from '@nhost/nextjs';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client';

const GET_WORKFLOW_BUILDER_DETAILS = gql`
  query GetWorkflowBuilderDetails($id: uuid!, $userId: uuid!) {
    workflow: workflows_by_pk(id: $id) {
      id
      org_id
      name
      description
      organization {
        name
        members(where: {user_id: {_eq: $userId}}) {
          role
        }
      }
      steps(order_by: {position: asc}) {
        id
        position
        name
        type
        config
      }
      triggers {
        id
        type
        config
        enabled
      }
    }
  }
`;

const SAVE_WORKFLOW_STEPS_AND_TRIGGERS = gql`
  mutation SaveWorkflowStepsAndTriggers(
    $workflowId: uuid!, 
    $steps: [workflow_steps_insert_input!]!,
    $triggers: [workflow_triggers_insert_input!]!
  ) {
    delete_workflow_steps(where: {workflow_id: {_eq: $workflowId}}) {
      affected_rows
    }
    insert_workflow_steps(objects: $steps) {
      affected_rows
    }
    delete_workflow_triggers(where: {workflow_id: {_eq: $workflowId}}) {
      affected_rows
    }
    insert_workflow_triggers(objects: $triggers) {
      affected_rows
    }
  }
`;

const RUN_WORKFLOW = gql`
  mutation RunWorkflow($workflowId: uuid!, $input: json!) {
    triggerWorkflowRun(workflowId: $workflowId, input: $input) {
      success
      message
      workflowRunId
      status
    }
  }
`;

interface WorkflowStep {
  id?: string;
  position: number;
  name: string;
  type: 'llm_call' | 'http_request' | 'db_write' | 'notify' | 'conditional_branch' | 'approval_gate';
  config: any;
}

interface WorkflowTrigger {
  id?: string;
  type: 'manual' | 'webhook';
  config: any;
  enabled: boolean;
}

export default function WorkflowBuilderPage() {
  const router = useRouter();
  const { id: workflowId } = useParams();
  const user = useUserData();
  const { isAuthenticated, isLoading: authCheckLoading } = useAuthenticationStatus();

  // Local state for step list
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [triggers, setTriggers] = useState<WorkflowTrigger[]>([]);

  // Selection states
  const [selectedStepIdx, setSelectedStepIdx] = useState<number | null>(null);

  // Trigger state values
  const [manualEnabled, setManualEnabled] = useState(true);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');

  // Execution manual input
  const [manualInputJson, setManualInputJson] = useState('{"text": "My package arrived damaged and I want a refund."}');

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // GraphQL query
  const { data, loading: queryLoading, error: queryError, refetch } = useQuery(GET_WORKFLOW_BUILDER_DETAILS, {
    variables: { id: workflowId, userId: user?.id || '00000000-0000-0000-0000-000000000000' },
    skip: !isAuthenticated || !user?.id,
  });

  // GraphQL mutations
  const [saveStepsAndTriggers, { loading: isSaving }] = useMutation(SAVE_WORKFLOW_STEPS_AND_TRIGGERS);
  const [triggerRun, { loading: isTriggering }] = useMutation(RUN_WORKFLOW);

  // Sync DB state to React local state
  useEffect(() => {
    if ((data as any)?.workflow) {
      // Map steps
      const dbSteps = (data as any).workflow.steps.map((s: any) => ({
        id: s.id,
        position: s.position,
        name: s.name,
        type: s.type,
        config: JSON.parse(JSON.stringify(s.config)) // deep copy
      }));
      setSteps(dbSteps);

      // Map triggers
      const dbTriggers = (data as any).workflow.triggers;
      const mTrig = dbTriggers.find((t: any) => t.type === 'manual');
      const wTrig = dbTriggers.find((t: any) => t.type === 'webhook');

      setManualEnabled(mTrig ? mTrig.enabled : true);
      setWebhookEnabled(wTrig ? wTrig.enabled : false);
      setWebhookSecret(wTrig?.config?.secret || '');

      // Create list of active triggers
      const list: WorkflowTrigger[] = [];
      if (mTrig) list.push({ type: 'manual', config: mTrig.config, enabled: mTrig.enabled });
      if (wTrig) list.push({ type: 'webhook', config: wTrig.config, enabled: wTrig.enabled });
      setTriggers(list);
    }
  }, [data]);

  // Auth redirect
  useEffect(() => {
    if (!authCheckLoading && !isAuthenticated && hasMounted) {
      router.push('/');
    }
  }, [isAuthenticated, authCheckLoading, hasMounted, router]);

  if (!hasMounted || authCheckLoading || queryLoading) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <p className="text-muted">Loading workflow builder...</p>
      </div>
    );
  }

  if (queryError || !(data as any)?.workflow) {
    return (
      <div className="app-container text-center">
        <h2 style={{ color: 'var(--error)' }}>Error Loading Workflow</h2>
        <p className="text-muted mt-16">{queryError?.message || 'Workflow not found.'}</p>
        <button className="btn btn-secondary mt-24" onClick={() => router.push('/dashboard')}>Back to Dashboard</button>
      </div>
    );
  }

  const workflow = (data as any).workflow;
  const userRole = workflow.organization?.members?.[0]?.role || 'viewer';

  // 1. Step Operations
  const addStep = (type: any) => {
    if (userRole === 'viewer') return;
    if ((type === 'db_write' || type === 'notify') && userRole !== 'owner') {
      alert('Only Owners can add privileged steps (DB Write, Notify).');
      return;
    }

    let defaultName = '';
    let defaultConfig: any = {};

    switch (type) {
      case 'llm_call':
        defaultName = 'AI Classifier';
        defaultConfig = { provider: 'gemini', model: 'gemini-2.5-flash', prompt: 'Analyze this input: {{input}}' };
        break;
      case 'http_request':
        defaultName = 'External API Check';
        defaultConfig = { url: 'https://httpbin.org/get', method: 'GET', headers: {}, body: {} };
        break;
      case 'conditional_branch':
        defaultName = 'Refund Condition';
        defaultConfig = { conditions: [{ field: 'refund_required', operator: 'equals', value: true }], true_step_id: '', false_step_id: '' };
        break;
      case 'approval_gate':
        defaultName = 'Manager Approval';
        defaultConfig = {};
        break;
      case 'db_write':
        defaultName = 'Log to Results Table';
        defaultConfig = {};
        break;
      case 'notify':
        defaultName = 'Slack Alert Trigger';
        defaultConfig = {};
        break;
    }

    const newStep: WorkflowStep = {
      position: steps.length,
      name: defaultName,
      type,
      config: defaultConfig
    };

    setSteps([...steps, newStep]);
    setSelectedStepIdx(steps.length);
  };

  const removeStep = (idx: number) => {
    if (userRole === 'viewer') return;
    const list = [...steps];
    list.splice(idx, 1);
    // Recalculate positions
    const updated = list.map((s, i) => ({ ...s, position: i }));
    setSteps(updated);
    setSelectedStepIdx(null);
  };

  const moveStep = (idx: number, direction: 'up' | 'down') => {
    if (userRole === 'viewer') return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= steps.length) return;

    const list = [...steps];
    const temp = list[idx];
    list[idx] = list[targetIdx];
    list[targetIdx] = temp;

    // Recalculate positions
    const updated = list.map((s, i) => ({ ...s, position: i }));
    setSteps(updated);
    setSelectedStepIdx(targetIdx);
  };

  // Drag and Drop handlers
  const handleDragStartPalette = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('stepType', type);
  };

  const handleDragStartNode = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('dragIdx', String(index));
  };

  const handleDragOverCanvas = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropCanvas = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('stepType');
    if (type) {
      addStep(type);
    }
  };

  const handleDropNode = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    const dragIdxStr = e.dataTransfer.getData('dragIdx');
    if (!dragIdxStr) return;
    const dragIdx = Number(dragIdxStr);
    if (dragIdx === targetIdx) return;

    const list = [...steps];
    const [removed] = list.splice(dragIdx, 1);
    list.splice(targetIdx, 0, removed);

    // Recalculate positions
    const updated = list.map((s, i) => ({ ...s, position: i }));
    setSteps(updated);
    setSelectedStepIdx(targetIdx);
  };

  const updateStepConfig = (field: string, val: any) => {
    if (selectedStepIdx === null) return;
    const list = [...steps];
    const item = { ...list[selectedStepIdx] };
    item.config = { ...item.config, [field]: val };
    list[selectedStepIdx] = item;
    setSteps(list);
  };

  const updateStepName = (name: string) => {
    if (selectedStepIdx === null) return;
    const list = [...steps];
    const item = { ...list[selectedStepIdx], name };
    list[selectedStepIdx] = item;
    setSteps(list);
  };

  // 2. Save trigger and step layout
  const handleSave = async () => {
    if (userRole === 'viewer') return;
    setErrorMsg('');
    setFeedbackMsg('');

    // Generate step array for insertion
    const stepInserts = steps.map((s) => ({
      workflow_id: workflowId,
      position: s.position,
      name: s.name,
      type: s.type,
      config: s.config
    }));

    // Generate trigger array for insertion
    const triggerInserts: any[] = [];
    
    // Manual is always present
    triggerInserts.push({
      workflow_id: workflowId,
      type: 'manual',
      config: {},
      enabled: manualEnabled
    });

    if (webhookEnabled) {
      if (userRole !== 'owner') {
        setErrorMsg('Only Owners can add Webhook Triggers.');
        return;
      }
      const secret = webhookSecret.trim() || Math.random().toString(36).substring(2, 15);
      triggerInserts.push({
        workflow_id: workflowId,
        type: 'webhook',
        config: { secret },
        enabled: true
      });
      setWebhookSecret(secret);
    }

    try {
      await saveStepsAndTriggers({
        variables: {
          workflowId,
          steps: stepInserts,
          triggers: triggerInserts
        }
      });
      setFeedbackMsg('Workflow saved successfully!');
      refetch();
    } catch (err: any) {
      setErrorMsg(`Save failed: ${err.message}`);
    }
  };

  // 3. Trigger manual execution
  const handleRunWorkflow = async () => {
    if (userRole === 'viewer') return;
    setErrorMsg('');
    setFeedbackMsg('');

    let parsedInput = {};
    try {
      parsedInput = JSON.parse(manualInputJson);
    } catch {
      setErrorMsg('Run input is not valid JSON.');
      return;
    }

    try {
      let runId = '';
      let success = false;
      let error = '';

      // Direct local development call bypass for debugging
      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        try {
          const localRes = await fetch('http://localhost:5001/v1/functions/trigger-workflow-run', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              action: {
                name: 'triggerWorkflowRun'
              },
              input: {
                workflowId,
                input: parsedInput
              },
              session_variables: {
                'x-hasura-user-id': user?.id || ''
              }
            })
          });
          const localData = await localRes.json();
          if (localData.success) {
            runId = localData.workflowRunId;
            success = true;
          } else {
            error = localData.message;
          }
        } catch (localErr: any) {
          console.warn('Failed to contact local functions runner, falling back to Hasura Cloud Action webhook...', localErr);
        }
      }

      if (!success) {
        const res = await triggerRun({
          variables: {
            workflowId,
            input: parsedInput
          }
        });
        if ((res.data as any)?.triggerWorkflowRun?.success) {
          runId = (res.data as any).triggerWorkflowRun.workflowRunId;
          success = true;
        } else {
          error = (res.data as any)?.triggerWorkflowRun?.message || 'Failed to start run.';
        }
      }

      if (success && runId) {
        router.push(`/runs/${runId}`);
      } else {
        setErrorMsg(error || 'Failed to start run.');
      }
    } catch (err: any) {
      setErrorMsg(`Run execution error: ${err.message}`);
    }
  };

  // Generate Webhook URL
  const backendUrl = process.env.NEXT_PUBLIC_NHOST_BACKEND_URL;
  const webhookUrl = `${backendUrl}/v1/functions/trigger-workflow-run?workflowId=${workflowId}&secret=${webhookSecret || 'YOUR_SECRET'}`;

  const selectedStep = selectedStepIdx !== null ? steps[selectedStepIdx] : null;

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <div className="brand" onClick={() => router.push('/dashboard')} style={{ cursor: 'pointer' }}>
            AI Agent<span>Workflow</span>
          </div>
          <div className="nav-links">
            <button className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={() => router.push('/dashboard')}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </header>

      <main className="app-container" style={{ paddingBottom: '80px' }}>
        {/* Title panel */}
        <div className="flex justify-between align-center mb-24" style={{ flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{workflow.name}</h2>
              <span className="badge badge-completed" style={{ background: 'var(--primary-glow)', color: '#d8b4fe', border: '1px solid rgba(139,92,246,0.3)' }}>
                Role: {userRole}
              </span>
            </div>
            <p className="text-muted mt-8">{workflow.description || 'No description'}</p>
          </div>

          {userRole !== 'viewer' && (
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Steps'}
              </button>
              <button className="btn btn-primary" onClick={() => {
                const modal = document.getElementById('run-modal-panel');
                if (modal) modal.style.display = 'block';
              }}>
                Run Workflow
              </button>
            </div>
          )}
        </div>

        {/* Global Feedback Banner */}
        {feedbackMsg && (
          <div style={{ padding: '12px 16px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', color: '#6ee7b7', fontSize: '0.85rem', marginBottom: '24px' }}>
            {feedbackMsg}
          </div>
        )}
        {errorMsg && (
          <div style={{ padding: '12px 16px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#fca5a5', fontSize: '0.85rem', marginBottom: '24px' }}>
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-3">
          {/* Column 1: Steps list */}
          <div className="glass-card flex flex-col gap-16" style={{ gridColumn: 'span 2' }}>
            <div className="flex justify-between align-center">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Workflow Steps</h3>
              <span className="text-muted" style={{ fontSize: '0.85rem' }}>{steps.length} Steps</span>
            </div>

            {steps.length === 0 ? (
              <div className="canvas-bg" style={{ justifyContent: 'center' }} onDragOver={handleDragOverCanvas} onDrop={handleDropCanvas}>
                <div className="text-center p-24 text-muted" style={{ border: '2px dashed var(--border-color)', borderRadius: '8px', maxWidth: '400px', background: 'rgba(0,0,0,0.3)' }}>
                  No steps defined. Drag & drop steps from the palette below to build your workflow.
                </div>
              </div>
            ) : (
              <div className="canvas-bg" onDragOver={handleDragOverCanvas} onDrop={handleDropCanvas}>
                {steps.map((s, idx) => {
                  let nodeClass = 'node-default';
                  let nodeIcon = '⚙️';
                  if (s.type === 'llm_call') { nodeClass = 'node-llm'; nodeIcon = '🤖'; }
                  else if (s.type === 'http_request') { nodeClass = 'node-http'; nodeIcon = '🌐'; }
                  else if (s.type === 'conditional_branch') { nodeClass = 'node-condition'; nodeIcon = '🔀'; }
                  else if (s.type === 'approval_gate') { nodeClass = 'node-approval'; nodeIcon = '⏸️'; }
                  else if (s.type === 'db_write') { nodeClass = 'node-db'; nodeIcon = '💾'; }
                  else if (s.type === 'notify') { nodeClass = 'node-notify'; nodeIcon = '🔔'; }

                  // Get previous step type for connector styling
                  const prevStepType = idx > 0 ? steps[idx-1].type : '';
                  let connectorClass = 'node-default';
                  if (prevStepType === 'llm_call') connectorClass = 'node-llm';
                  else if (prevStepType === 'http_request') connectorClass = 'node-http';
                  else if (prevStepType === 'conditional_branch') connectorClass = 'node-condition';
                  else if (prevStepType === 'approval_gate') connectorClass = 'node-approval';
                  else if (prevStepType === 'db_write') connectorClass = 'node-db';
                  else if (prevStepType === 'notify') connectorClass = 'node-notify';

                  return (
                    <React.Fragment key={idx}>
                      {idx > 0 && <div className={`step-connector ${connectorClass}`} />}
                      
                      <div
                        onClick={() => setSelectedStepIdx(idx)}
                        className={`step-node-card ${nodeClass} ${selectedStepIdx === idx ? 'active' : ''}`}
                        draggable={userRole !== 'viewer'}
                        onDragStart={(e) => handleDragStartNode(e, idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleDropNode(e, idx)}
                        style={{ cursor: userRole === 'viewer' ? 'pointer' : 'grab' }}
                      >
                        <div className="flex align-center gap-16">
                          <div className="node-icon-wrapper">
                            {nodeIcon}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{s.name}</div>
                            <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', marginTop: '2px', letterSpacing: '0.05em' }}>
                              {s.type.replace('_', ' ')}
                            </div>
                          </div>
                        </div>

                        {userRole !== 'viewer' && (
                          <div className="flex align-center gap-8" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.7rem', borderRadius: '4px' }}
                              onClick={() => moveStep(idx, 'up')}
                              disabled={idx === 0}
                              title="Move Up"
                            >
                              ▲
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.7rem', borderRadius: '4px' }}
                              onClick={() => moveStep(idx, 'down')}
                              disabled={idx === steps.length - 1}
                              title="Move Down"
                            >
                              ▼
                            </button>
                            <button
                              className="btn btn-danger"
                              style={{ padding: '4px 8px', fontSize: '0.7rem', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5' }}
                              onClick={() => removeStep(idx)}
                              title="Delete Step"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            {/* Step selector palette */}
            {userRole !== 'viewer' && (
              <div style={{ marginTop: '16px' }}>
                <div className="flex align-center gap-8 mb-8">
                  <span className="form-label" style={{ margin: 0 }}>Add Step</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    (Drag steps onto the canvas or drag cards to reorder them!)
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '8px 12px', fontSize: '0.8rem', cursor: 'grab' }}
                    onClick={() => addStep('llm_call')}
                    draggable="true"
                    onDragStart={(e) => handleDragStartPalette(e, 'llm_call')}
                  >
                    🤖 LLM Call
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '8px 12px', fontSize: '0.8rem', cursor: 'grab' }}
                    onClick={() => addStep('http_request')}
                    draggable="true"
                    onDragStart={(e) => handleDragStartPalette(e, 'http_request')}
                  >
                    🌐 HTTP Request
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '8px 12px', fontSize: '0.8rem', cursor: 'grab' }}
                    onClick={() => addStep('conditional_branch')}
                    draggable="true"
                    onDragStart={(e) => handleDragStartPalette(e, 'conditional_branch')}
                  >
                    🔀 Condition
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '8px 12px', fontSize: '0.8rem', cursor: 'grab' }}
                    onClick={() => addStep('approval_gate')}
                    draggable="true"
                    onDragStart={(e) => handleDragStartPalette(e, 'approval_gate')}
                  >
                    ⏸️ Approval Gate
                  </button>
                  {userRole === 'owner' && (
                    <>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '8px 12px', fontSize: '0.8rem', border: '1px solid rgba(16,185,129,0.3)', cursor: 'grab' }}
                        onClick={() => addStep('db_write')}
                        draggable="true"
                        onDragStart={(e) => handleDragStartPalette(e, 'db_write')}
                      >
                        💾 DB Write
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '8px 12px', fontSize: '0.8rem', border: '1px solid rgba(16,185,129,0.3)', cursor: 'grab' }}
                        onClick={() => addStep('notify')}
                        draggable="true"
                        onDragStart={(e) => handleDragStartPalette(e, 'notify')}
                      >
                        🔔 Notify
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Column 2: Selected step config or Triggers */}
          <div className="glass-card flex flex-col gap-24">
            {selectedStep ? (
              <div>
                <div className="flex justify-between align-center" style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Configure Step</h3>
                  <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => setSelectedStepIdx(null)}>
                    Back to Triggers
                  </button>
                </div>

                <div className="form-group">
                  <label className="form-label">Step Name</label>
                  <input
                    type="text"
                    value={selectedStep.name}
                    onChange={(e) => updateStepName(e.target.value)}
                    className="input-field"
                    disabled={userRole === 'viewer'}
                  />
                </div>

                {/* Configuration form depending on type */}
                {selectedStep.type === 'llm_call' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Provider</label>
                      <select
                        value={selectedStep.config.provider}
                        onChange={(e) => updateStepConfig('provider', e.target.value)}
                        className="input-field"
                        disabled={userRole === 'viewer'}
                      >
                        <option value="gemini">Gemini</option>
                        <option value="groq">Groq</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Model</label>
                      <input
                        type="text"
                        value={selectedStep.config.model}
                        onChange={(e) => updateStepConfig('model', e.target.value)}
                        className="input-field"
                        disabled={userRole === 'viewer'}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Prompt Template</label>
                      <textarea
                        value={selectedStep.config.prompt}
                        onChange={(e) => updateStepConfig('prompt', e.target.value)}
                        className="input-field"
                        style={{ minHeight: '120px', fontFamily: 'inherit' }}
                        placeholder="Use {{input}} to inject user text"
                        disabled={userRole === 'viewer'}
                      />
                    </div>
                  </>
                )}

                {selectedStep.type === 'http_request' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Request Method</label>
                      <select
                        value={selectedStep.config.method}
                        onChange={(e) => updateStepConfig('method', e.target.value)}
                        className="input-field"
                        disabled={userRole === 'viewer'}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">URL Endpoint</label>
                      <input
                        type="text"
                        value={selectedStep.config.url}
                        onChange={(e) => updateStepConfig('url', e.target.value)}
                        className="input-field"
                        placeholder="https://api.mycompany.com/check"
                        disabled={userRole === 'viewer'}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Headers (JSON)</label>
                      <textarea
                        value={typeof selectedStep.config.headers === 'object' ? JSON.stringify(selectedStep.config.headers, null, 2) : selectedStep.config.headers}
                        onChange={(e) => {
                          try {
                            updateStepConfig('headers', JSON.parse(e.target.value));
                          } catch {
                            // let user type unfinished json
                          }
                        }}
                        className="input-field"
                        style={{ minHeight: '85px', fontFamily: 'monospace', fontSize: '0.8rem' }}
                        placeholder='{ "Authorization": "Bearer key" }'
                        disabled={userRole === 'viewer'}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Body Payload (JSON)</label>
                      <textarea
                        value={typeof selectedStep.config.body === 'object' ? JSON.stringify(selectedStep.config.body, null, 2) : selectedStep.config.body}
                        onChange={(e) => {
                          try {
                            updateStepConfig('body', JSON.parse(e.target.value));
                          } catch {
                            // let user type unfinished json
                          }
                        }}
                        className="input-field"
                        style={{ minHeight: '85px', fontFamily: 'monospace', fontSize: '0.8rem' }}
                        placeholder='{ "userId": 123 }'
                        disabled={userRole === 'viewer'}
                      />
                    </div>
                  </>
                )}

                {selectedStep.type === 'conditional_branch' && (
                  <>
                    <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: '16px' }}>
                      Defines comparison logic against the output fields of the immediate previous step run.
                    </p>
                    
                    {/* Simplified fields for conditions */}
                    <div className="form-group">
                      <label className="form-label">Match Field Path</label>
                      <input
                        type="text"
                        value={selectedStep.config.conditions?.[0]?.field || ''}
                        onChange={(e) => {
                          const cond = { ...selectedStep.config.conditions[0], field: e.target.value };
                          updateStepConfig('conditions', [cond]);
                        }}
                        className="input-field"
                        placeholder="refund_required"
                        disabled={userRole === 'viewer'}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Operator</label>
                      <select
                        value={selectedStep.config.conditions?.[0]?.operator || 'equals'}
                        onChange={(e) => {
                          const cond = { ...selectedStep.config.conditions[0], operator: e.target.value };
                          updateStepConfig('conditions', [cond]);
                        }}
                        className="input-field"
                        disabled={userRole === 'viewer'}
                      >
                        <option value="equals">equals</option>
                        <option value="not_equals">not equals</option>
                        <option value="contains">contains</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Comparison Value</label>
                      <select
                        value={String(selectedStep.config.conditions?.[0]?.value)}
                        onChange={(e) => {
                          let val: any = e.target.value;
                          if (val === 'true') val = true;
                          if (val === 'false') val = false;
                          const cond = { ...selectedStep.config.conditions[0], value: val };
                          updateStepConfig('conditions', [cond]);
                        }}
                        className="input-field"
                        disabled={userRole === 'viewer'}
                      >
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    </div>

                    <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '16px 0' }} />

                    <div className="form-group">
                      <label className="form-label">Route If True (Target Step ID)</label>
                      <select
                        value={selectedStep.config.true_step_id || ''}
                        onChange={(e) => updateStepConfig('true_step_id', e.target.value)}
                        className="input-field"
                        disabled={userRole === 'viewer'}
                      >
                        <option value="END">🛑 End Workflow</option>
                        <option value="">Next Position Step</option>
                        {steps.filter(s => s.position !== selectedStep.position).map(s => (
                          <option key={s.id || s.position} value={s.id}>
                            Position {s.position + 1}: {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Route If False (Target Step ID)</label>
                      <select
                        value={selectedStep.config.false_step_id || ''}
                        onChange={(e) => updateStepConfig('false_step_id', e.target.value)}
                        className="input-field"
                        disabled={userRole === 'viewer'}
                      >
                        <option value="END">🛑 End Workflow</option>
                        <option value="">Next Position Step</option>
                        {steps.filter(s => s.position !== selectedStep.position).map(s => (
                          <option key={s.id || s.position} value={s.id}>
                            Position {s.position + 1}: {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {selectedStep.type === 'approval_gate' && (
                  <p className="text-muted text-center p-24" style={{ fontSize: '0.85rem' }}>
                    Approval gate has no custom configurations. When reached, execution will pause until approved by an Owner or Editor.
                  </p>
                )}

                {selectedStep.type === 'db_write' && (
                  <p className="text-muted text-center p-24" style={{ fontSize: '0.85rem' }}>
                    DB Write has no custom configurations. It automatically writes the output of the preceding step into the `workflow_results` database table.
                  </p>
                )}

                {selectedStep.type === 'notify' && (
                  <p className="text-muted text-center p-24" style={{ fontSize: '0.85rem' }}>
                    Notify has no custom configurations. It triggers a logged notification when completed.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px' }}>Configure Triggers</h3>

                <div className="form-group">
                  <div className="flex align-center gap-8" style={{ padding: '8px 0' }}>
                    <input
                      type="checkbox"
                      checked={manualEnabled}
                      onChange={(e) => setManualEnabled(e.target.checked)}
                      disabled={userRole === 'viewer'}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <label style={{ fontWeight: 600 }}>Manual Trigger (Run Button)</label>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '24px' }}>
                  <div className="flex align-center gap-8" style={{ padding: '8px 0' }}>
                    <input
                      type="checkbox"
                      checked={webhookEnabled}
                      onChange={(e) => {
                        if (userRole !== 'owner') {
                          alert('Only Owners can add Webhook Triggers.');
                          return;
                        }
                        setWebhookEnabled(e.target.checked);
                      }}
                      disabled={userRole === 'viewer'}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <label style={{ fontWeight: 600 }}>Webhook Trigger (External HTTP)</label>
                  </div>

                  {webhookEnabled && (
                    <div style={{ marginTop: '12px', padding: '16px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                      <div className="form-group" style={{ marginBottom: '12px' }}>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Webhook Secret</label>
                        <div className="flex gap-8">
                          <input
                            type="text"
                            value={webhookSecret}
                            onChange={(e) => setWebhookSecret(e.target.value)}
                            className="input-field"
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                            placeholder="my-secret-token"
                            disabled={userRole === 'viewer'}
                          />
                          <button
                            className="btn btn-secondary"
                            onClick={(e) => {
                              e.preventDefault();
                              setWebhookSecret(Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
                            }}
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                            disabled={userRole === 'viewer'}
                          >
                            Regen
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>POST Endpoint URL</label>
                        <textarea
                          readOnly
                          value={webhookUrl}
                          className="input-field"
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '0.7rem',
                            minHeight: '65px',
                            background: 'rgba(0,0,0,0.3)',
                            resize: 'none',
                            color: 'var(--text-muted)'
                          }}
                          onClick={(e) => (e.target as any).select()}
                        />
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Click to select and copy. Call this URL with your payload in the HTTP body.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Manual Run Modal Panel (rendered inside overlay) */}
        <div id="run-modal-panel" style={{
          display: 'none',
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.7)',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="glass-card" style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            maxWidth: '500px',
            width: '100%',
            padding: '32px'
          }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>Run Workflow</h3>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '20px' }}>
              Provide the input JSON parameters that will be passed into this execution.
            </p>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Input JSON</label>
              <textarea
                value={manualInputJson}
                onChange={(e) => setManualInputJson(e.target.value)}
                className="input-field"
                style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => {
                const modal = document.getElementById('run-modal-panel');
                if (modal) modal.style.display = 'none';
              }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleRunWorkflow} disabled={isTriggering}>
                {isTriggering ? 'Triggering...' : 'Trigger Run'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
