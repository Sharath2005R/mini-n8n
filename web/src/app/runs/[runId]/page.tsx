// web/src/app/runs/[runId]/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthenticationStatus, useUserData } from '@nhost/nextjs';
import { useSubscription, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client';

const SUBSCRIBE_WORKFLOW_RUN_LIVE = gql`
  subscription GetWorkflowRunLive($runId: uuid!) {
    workflow_run: workflow_runs_by_pk(id: $runId) {
      id
      status
      trigger_type
      input
      error
      started_at
      completed_at
      workflow {
        id
        name
        org_id
        organization {
          members {
            user_id
            role
          }
        }
        steps(order_by: {position: asc}) {
          id
          name
          type
          position
        }
      }
      step_runs(order_by: {created_at: asc}) {
        id
        workflow_step_id
        status
        input
        output
        error
        attempt_count
        approved_by
        approved_at
        started_at
        completed_at
      }
    }
  }
`;

const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(stepRunId: $stepRunId) {
      success
      message
      workflowRunId
      stepRunId
      status
    }
  }
`;

export default function RunMonitorPage() {
  const router = useRouter();
  const { runId } = useParams();
  const user = useUserData();
  const { isAuthenticated, isLoading: authCheckLoading } = useAuthenticationStatus();

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // GraphQL subscription for live updates
  const { data, loading: subLoading, error: subError } = useSubscription(SUBSCRIBE_WORKFLOW_RUN_LIVE, {
    variables: { runId },
    skip: !isAuthenticated,
  });

  // GraphQL mutation
  const [approveStep, { loading: isApproving }] = useMutation(APPROVE_STEP);

  // Auth redirect
  useEffect(() => {
    if (!authCheckLoading && !isAuthenticated && hasMounted) {
      router.push('/');
    }
  }, [isAuthenticated, authCheckLoading, hasMounted, router]);

  if (!hasMounted || authCheckLoading || subLoading) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <p className="text-muted">Establishing live connection to run monitor...</p>
      </div>
    );
  }

  if (subError || !(data as any)?.workflow_run) {
    return (
      <div className="app-container text-center">
        <h2 style={{ color: 'var(--error)' }}>Error Loading Run Status</h2>
        <p className="text-muted mt-16">{subError?.message || 'Workflow run execution data not found.'}</p>
        <button className="btn btn-secondary mt-24" onClick={() => router.push('/dashboard')}>Back to Dashboard</button>
      </div>
    );
  }

  const run = (data as any).workflow_run;
  const workflow = run.workflow;
  const steps = workflow.steps || [];
  const stepRuns = run.step_runs || [];

  // Determine current user's role in the organization
  const userRole = workflow.organization?.members?.find((m: any) => m.user_id === user?.id)?.role || 'viewer';

  const handleApprove = async (stepRunId: string) => {
    if (userRole === 'viewer') return;
    setFeedbackMsg('');
    setErrorMsg('');

    try {
      let success = false;
      let message = '';

      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        try {
          const localRes = await fetch('http://localhost:5001/v1/functions/approve-step', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              action: {
                name: 'approveStep'
              },
              input: {
                stepRunId
              },
              session_variables: {
                'x-hasura-user-id': user?.id || ''
              }
            })
          });
          const localData = await localRes.json();
          if (localData && localData.success) {
            success = true;
            message = localData.message;
          } else {
            message = localData.message || 'Failed to approve step locally.';
          }
        } catch (localErr) {
          console.warn('Failed to contact local functions runner for approval, falling back to Hasura Cloud Action webhook...', localErr);
        }
      }

      if (!success) {
        const res = await approveStep({
          variables: { stepRunId }
        });
        if ((res.data as any)?.approveStep?.success) {
          success = true;
          message = (res.data as any).approveStep.message || 'Step approved successfully. Resuming workflow...';
        } else {
          message = (res.data as any)?.approveStep?.message || 'Failed to approve step.';
        }
      }

      if (success) {
        setFeedbackMsg(message || 'Step approved successfully.');
      } else {
        setErrorMsg(message || 'Failed to approve step.');
      }
    } catch (err: any) {
      setErrorMsg(`Approval error: ${err.message}`);
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'running': return 'badge-running';
      case 'paused': return 'badge-paused';
      case 'completed': return 'badge-completed';
      case 'failed': return 'badge-failed';
      case 'skipped': return 'badge-skipped';
      default: return 'badge-pending';
    }
  };

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <div className="brand" onClick={() => router.push('/dashboard')} style={{ cursor: 'pointer' }}>
            AI Agent<span>Workflow</span>
          </div>
          <div className="nav-links">
            <button className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={() => router.push(`/workflows/${workflow.id}`)}>
              Back to Builder
            </button>
            <button className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={() => router.push('/dashboard')}>
              Dashboard
            </button>
          </div>
        </div>
      </header>

      <main className="app-container">
        {/* Run Summary Card */}
        <div className="glass-card mb-24 flex justify-between align-center" style={{ flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span className="text-muted" style={{ fontSize: '0.85rem', textTransform: 'uppercase' }}>
              Run Monitor for: <strong style={{ color: 'white' }}>{workflow.name}</strong>
            </span>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '4px' }}>
              Run #{run.id.substring(0, 8)}
            </h2>
            <div className="text-muted mt-8" style={{ fontSize: '0.85rem' }}>
              Triggered via <strong style={{ color: '#d8b4fe' }}>{run.trigger_type}</strong> | Started at {new Date(run.started_at || run.created_at).toLocaleString()}
              {run.completed_at && ` | Completed at ${new Date(run.completed_at).toLocaleString()}`}
            </div>
          </div>

          <div className="flex align-center gap-16">
            <span className={`badge ${getStatusBadgeClass(run.status)}`} style={{ fontSize: '1rem', padding: '8px 16px' }}>
              {run.status}
            </span>
          </div>
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

        {/* Workflow Master Error Banner */}
        {run.error && (
          <div className="glass-card mb-24" style={{ borderColor: 'var(--error)', background: 'rgba(239,68,68,0.05)' }}>
            <h4 style={{ color: '#fca5a5', marginBottom: '8px', fontWeight: 600 }}>Workflow Execution Error</h4>
            <pre style={{ color: '#fca5a5', fontSize: '0.85rem', fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
              {run.error}
            </pre>
          </div>
        )}

        <div className="grid grid-cols-3">
          {/* Column 1: Step Runs Execution Log */}
          <div className="glass-card flex flex-col gap-16" style={{ gridColumn: 'span 2' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '8px' }}>Step-by-step Progress</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {steps.map((step: any, idx: number) => {
                // Find matching step run
                const sRun = stepRuns.find((sr: any) => sr.workflow_step_id === step.id);
                const stepStatus = sRun ? sRun.status : 'pending';

                return (
                  <div key={step.id} style={{ display: 'flex', gap: '16px' }}>
                    {/* Visual Line connector */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: stepStatus === 'completed' ? 'var(--success)' : stepStatus === 'running' ? 'var(--info)' : stepStatus === 'paused' ? 'var(--warning)' : stepStatus === 'failed' ? 'var(--error)' : 'rgba(255,255,255,0.05)',
                        border: '2px solid rgba(255,255,255,0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: stepStatus === 'pending' ? 'var(--text-muted)' : 'white',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        zIndex: 10
                      }}>
                        {idx + 1}
                      </div>
                      {idx < steps.length - 1 && (
                        <div style={{
                          flex: 1,
                          width: '2px',
                          background: stepStatus === 'completed' ? 'var(--success)' : 'rgba(255,255,255,0.08)',
                          minHeight: '40px',
                          margin: '4px 0'
                        }} />
                      )}
                    </div>

                    {/* Step Content Card */}
                    <div className="glass-card" style={{ flex: 1, padding: '16px', background: sRun ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.1)' }}>
                      <div className="flex justify-between align-center">
                        <div>
                          <h4 style={{ fontWeight: 600 }}>{step.name}</h4>
                          <span className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>
                            {step.type.replace('_', ' ')}
                          </span>
                        </div>
                        <span className={`badge ${getStatusBadgeClass(stepStatus)}`}>
                          {stepStatus}
                        </span>
                      </div>

                      {sRun && (
                        <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '12px' }}>
                          {/* Inputs, outputs, error */}
                          {sRun.attempt_count > 1 && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginBottom: '8px' }}>
                              Attempt Count: {sRun.attempt_count} (Retried)
                            </div>
                          )}

                          {sRun.error && (
                            <div style={{ background: 'rgba(239, 68, 68, 0.05)', borderLeft: '3px solid var(--error)', padding: '8px 12px', borderRadius: '4px', fontSize: '0.8rem', color: '#fca5a5', marginBottom: '12px', fontFamily: 'monospace' }}>
                              <strong>Error:</strong> {sRun.error}
                            </div>
                          )}

                          {/* Render Approval Panel */}
                          {step.type === 'approval_gate' && stepStatus === 'paused' && (
                            <div style={{ background: 'var(--warning-glow)', border: '1px solid rgba(245,158,11,0.2)', padding: '16px', borderRadius: '8px', marginTop: '8px' }}>
                              <h5 style={{ fontWeight: 600, color: '#fde047', marginBottom: '8px' }}>Awaiting Approval</h5>
                              <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '16px' }}>
                                Approval is required to resume execution. Owners and Editors can approve.
                              </p>
                              {(userRole === 'owner' || userRole === 'editor') && (
                                <button className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '0.85rem', background: 'var(--warning)', color: 'black' }} onClick={() => handleApprove(sRun.id)} disabled={isApproving}>
                                  {isApproving ? 'Approving...' : '✓ Approve Step Run'}
                                </button>
                              )}
                              <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '12px' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--info)', marginBottom: '8px' }}>🔗 External Approval Action Links</div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                  <a 
                                    href={`http://localhost:5001/v1/functions/external-approve?stepRunId=${sRun.id}&action=approve`} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="btn btn-secondary"
                                    style={{ padding: '6px 12px', fontSize: '0.75rem', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399', textDecoration: 'none', display: 'inline-block' }}
                                  >
                                    🟢 Approve Link
                                  </a>
                                  <a 
                                    href={`http://localhost:5001/v1/functions/external-approve?stepRunId=${sRun.id}&action=reject`} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="btn btn-secondary"
                                    style={{ padding: '6px 12px', fontSize: '0.75rem', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', textDecoration: 'none', display: 'inline-block' }}
                                  >
                                    🔴 Reject Link
                                  </a>
                                </div>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: '8px' }}>
                                  You can trigger these pre-signed endpoints from external systems like Email templates or Slack webhooks.
                                </span>
                              </div>
                            </div>
                          )}

                          {step.type === 'approval_gate' && stepStatus === 'completed' && sRun.approved_by && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                              Approved by User <strong>{sRun.approved_by.substring(0, 8)}</strong> at {new Date(sRun.approved_at).toLocaleString()}
                            </div>
                          )}

                          {/* Accordion toggle parameters */}
                          <div style={{ display: 'flex', gap: '24px', fontSize: '0.75rem', marginTop: '8px' }}>
                            <div>
                              <span style={{ fontWeight: 600, display: 'block', color: 'var(--text-muted)', marginBottom: '4px' }}>INPUT</span>
                              <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', maxWidth: '300px', overflowX: 'auto', fontFamily: 'monospace' }}>
                                {JSON.stringify(sRun.input, null, 2)}
                              </pre>
                            </div>
                            {stepStatus === 'completed' && (
                              <div>
                                <span style={{ fontWeight: 600, display: 'block', color: 'var(--text-muted)', marginBottom: '4px' }}>OUTPUT</span>
                                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', maxWidth: '300px', overflowX: 'auto', fontFamily: 'monospace' }}>
                                  {JSON.stringify(sRun.output, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Column 2: Run details / parameters */}
          <div className="glass-card flex flex-col gap-16">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Workflow Input</h3>
            <p className="text-muted" style={{ fontSize: '0.85rem' }}>
              The payload that initiated this execution.
            </p>
            <pre style={{
              background: 'rgba(0,0,0,0.4)',
              padding: '16px',
              borderRadius: '8px',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              overflowX: 'auto',
              border: '1px solid var(--border-color)'
            }}>
              {JSON.stringify(run.input, null, 2)}
            </pre>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '12px 0' }} />

            <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Debugging Info</h3>
            <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <span className="text-muted">Workflow ID:</span>
                <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', marginTop: '2px' }}>{workflow.id}</div>
              </div>
              <div>
                <span className="text-muted">Run ID:</span>
                <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', marginTop: '2px' }}>{run.id}</div>
              </div>
              <div>
                <span className="text-muted">Organization:</span>
                <div style={{ marginTop: '2px', fontWeight: 500 }}>{workflow.organization?.name || 'N/A'}</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
