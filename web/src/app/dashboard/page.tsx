// web/src/app/dashboard/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthenticationStatus, useUserData, useSignOut } from '@nhost/nextjs';
import { useQuery, useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client';

const GET_USER_ORGANIZATIONS = gql`
  query GetUserOrganizations($userId: uuid!) {
    org_members {
      id
      user_id
      role
      org_id
      organization {
        id
        name
        quota_limit
        quota_used
        workflows {
          id
          name
          description
          created_at
          runs(order_by: {created_at: desc}, limit: 1) {
            id
            status
            created_at
          }
        }
        members {
          id
          user_id
          role
          user {
            displayName
            email
          }
        }
        invites(where: {status: {_eq: "pending"}}) {
          id
          role
          invited_user_id
          invited_user {
            displayName
            email
          }
        }
      }
    }
    received_invites: org_invites(where: {status: {_eq: "pending"}, invited_user_id: {_eq: $userId}}) {
      id
      role
      organization {
        id
        name
      }
      inviter {
        displayName
      }
    }
  }
`;

const CREATE_ORGANIZATION = gql`
  mutation CreateOrganization($name: String!, $userId: uuid!) {
    insert_organizations_one(object: {
      name: $name,
      members: {
        data: {
          user_id: $userId,
          role: "owner"
        }
      }
    }) {
      id
      name
    }
  }
`;

const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($name: String!, $description: String!, $orgId: uuid!, $userId: uuid!) {
    insert_workflows_one(object: {
      name: $name,
      description: $description,
      org_id: $orgId,
      created_by: $userId
    }) {
      id
      name
    }
  }
`;

const DELETE_WORKFLOW = gql`
  mutation DeleteWorkflow($id: uuid!) {
    delete_workflows_by_pk(id: $id) {
      id
    }
  }
`;

const CREATE_ORG_INVITE = gql`
  mutation CreateOrgInvite($orgId: uuid!, $invitedUserId: uuid!, $role: String!) {
    insert_org_invites_one(object: {
      org_id: $orgId,
      invited_user_id: $invitedUserId,
      role: $role
    }) {
      id
      role
    }
  }
`;

const RESPOND_TO_INVITE = gql`
  mutation RespondToInvite($id: uuid!, $status: String!) {
    update_org_invites_by_pk(pk_columns: {id: $id}, _set: {status: $status}) {
      id
      status
    }
  }
`;

const CANCEL_ORG_INVITE = gql`
  mutation CancelOrgInvite($id: uuid!) {
    delete_org_invites_by_pk(id: $id) {
      id
    }
  }
`;

const REMOVE_ORG_MEMBER = gql`
  mutation RemoveOrgMember($id: uuid!) {
    delete_org_members_by_pk(id: $id) {
      id
    }
  }
`;

export default function DashboardPage() {
  const router = useRouter();
  const user = useUserData();
  const { signOut } = useSignOut();
  const { isAuthenticated, isLoading: authCheckLoading } = useAuthenticationStatus();

  // Selected Organization index
  const [selectedOrgIdx, setSelectedOrgIdx] = useState(0);

  // Form states
  const [newOrgName, setNewOrgName] = useState('');
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newWorkflowDesc, setNewWorkflowDesc] = useState('');
  const [newMemberId, setNewMemberId] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('viewer');

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Apollo Query
  const { data, loading: queryLoading, error: queryError, refetch } = useQuery(GET_USER_ORGANIZATIONS, {
    variables: { userId: user?.id || '00000000-0000-0000-0000-000000000000' },
    skip: !isAuthenticated || !user?.id,
  });

  // Apollo Mutations
  const [createOrg, { loading: createOrgLoading }] = useMutation(CREATE_ORGANIZATION);
  const [createWorkflow, { loading: createWfLoading }] = useMutation(CREATE_WORKFLOW);
  const [deleteWorkflow] = useMutation(DELETE_WORKFLOW);
  const [inviteMember, { loading: inviteMemberLoading }] = useMutation(CREATE_ORG_INVITE);
  const [respondToInvite] = useMutation(RESPOND_TO_INVITE);
  const [cancelInvite] = useMutation(CANCEL_ORG_INVITE);
  const [removeMember] = useMutation(REMOVE_ORG_MEMBER);

  // Check auth
  useEffect(() => {
    if (!authCheckLoading && !isAuthenticated && hasMounted) {
      router.push('/');
    }
  }, [isAuthenticated, authCheckLoading, hasMounted, router]);

  if (!hasMounted || authCheckLoading || queryLoading) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <p className="text-muted">Loading your workspace...</p>
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="app-container text-center">
        <h2 style={{ color: 'var(--error)' }}>Error Loading Dashboard</h2>
        <p className="text-muted mt-16">{queryError.message}</p>
        <button className="btn btn-secondary mt-24" onClick={() => refetch()}>Retry</button>
      </div>
    );
  }

  const rawMemberships = (data as any)?.org_members || [];
  const memberships = rawMemberships.filter((mem: any) => mem.user_id === user?.id);
  const receivedInvites = (data as any)?.received_invites || [];
  const currentMembership = memberships[selectedOrgIdx];
  const activeOrg = currentMembership?.organization;
  const userRole = currentMembership?.role; // 'owner' | 'editor' | 'viewer'

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim() || !user?.id) return;
    try {
      await createOrg({ variables: { name: newOrgName, userId: user.id } });
      setNewOrgName('');
      setFeedbackMsg('Organization created successfully!');
      refetch();
    } catch (err: any) {
      setFeedbackMsg(`Error: ${err.message}`);
    }
  };

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkflowName.trim() || !activeOrg?.id || !user?.id) return;
    try {
      await createWorkflow({
        variables: {
          name: newWorkflowName,
          description: newWorkflowDesc,
          orgId: activeOrg.id,
          userId: user.id
        }
      });
      setNewWorkflowName('');
      setNewWorkflowDesc('');
      setFeedbackMsg('Workflow created successfully!');
      refetch();
    } catch (err: any) {
      setFeedbackMsg(`Error: ${err.message}`);
    }
  };

  const handleDeleteWorkflow = async (wfId: string) => {
    if (!confirm('Are you sure you want to delete this workflow? All runs will be deleted.')) return;
    try {
      await deleteWorkflow({ variables: { id: wfId } });
      setFeedbackMsg('Workflow deleted.');
      refetch();
    } catch (err: any) {
      setFeedbackMsg(`Error: ${err.message}`);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetUserId = newMemberId.trim();
    if (!targetUserId || !activeOrg?.id) return;

    // 1. Check if user is already a member
    const isAlreadyMember = activeOrg.members.some((mem: any) => mem.user_id === targetUserId);
    if (isAlreadyMember) {
      setFeedbackMsg('Error: This user is already a member of this organization.');
      return;
    }

    // 2. Check if user has a pending invitation
    const isAlreadyInvited = activeOrg.invites?.some((inv: any) => inv.invited_user_id === targetUserId);
    if (isAlreadyInvited) {
      setFeedbackMsg('Error: This user has already been invited to this organization.');
      return;
    }

    try {
      await inviteMember({
        variables: {
          orgId: activeOrg.id,
          invitedUserId: targetUserId,
          role: newMemberRole
        }
      });
      setNewMemberId('');
      setFeedbackMsg('Invitation sent successfully!');
      refetch();
    } catch (err: any) {
      setFeedbackMsg(`Error: ${err.message}`);
    }
  };

  const handleRespondToInvite = async (inviteId: string, status: 'accepted' | 'declined') => {
    try {
      if (status === 'declined') {
        await cancelInvite({
          variables: { id: inviteId }
        });
        setFeedbackMsg('Invitation declined.');
      } else {
        await respondToInvite({
          variables: {
            id: inviteId,
            status
          }
        });
        setFeedbackMsg('Invitation accepted!');
      }
      refetch();
    } catch (err: any) {
      setFeedbackMsg(`Error: ${err.message}`);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!confirm('Are you sure you want to cancel this invitation?')) return;
    try {
      await cancelInvite({ variables: { id: inviteId } });
      setFeedbackMsg('Invitation cancelled.');
      refetch();
    } catch (err: any) {
      setFeedbackMsg(`Error: ${err.message}`);
    }
  };

  const handleRemoveMember = async (memId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    try {
      await removeMember({ variables: { id: memId } });
      setFeedbackMsg('Member removed.');
      refetch();
    } catch (err: any) {
      setFeedbackMsg(`Error: ${err.message}`);
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'running': return 'badge-running';
      case 'paused': return 'badge-paused';
      case 'completed': return 'badge-completed';
      case 'failed': return 'badge-failed';
      default: return 'badge-pending';
    }
  };

  // 1. Onboarding State (User has no organizations)
  if (memberships.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px', gap: '24px' }}>
        {receivedInvites.length > 0 && (
          <div className="glass-card" style={{ maxWidth: '500px', width: '100%', border: '1px solid rgba(139, 92, 246, 0.4)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: '#d8b4fe' }}>
              Pending Organization Invitations ({receivedInvites.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {receivedInvites.map((invite: any) => (
                <div key={invite.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.05)', padding: '12px', borderRadius: '8px', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{invite.organization?.name || 'Pending Organization'}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Invited by: {invite.inviter?.displayName || 'Owner'} ({invite.role})
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleRespondToInvite(invite.id, 'accepted')}>
                      Accept
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleRespondToInvite(invite.id, 'declined')}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="glass-card" style={{ maxWidth: '500px', width: '100%' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '16px', textAlign: 'center' }}>
            Welcome to AI Agent Workflow
          </h2>
          <p className="text-muted text-center" style={{ marginBottom: '32px' }}>
            To get started, create an organization. You will be set as the Owner and can invite your team members.
          </p>

          {feedbackMsg && (
            <div style={{
              padding: '12px 16px',
              borderRadius: '8px',
              background: 'rgba(139, 92, 246, 0.1)',
              border: '1px solid rgba(139, 92, 246, 0.2)',
              fontSize: '0.85rem',
              marginBottom: '20px',
              color: '#d8b4fe'
            }}>
              {feedbackMsg}
            </div>
          )}

          <form onSubmit={handleCreateOrg}>
            <div className="form-group">
              <label className="form-label">Organization Name</label>
              <input
                type="text"
                className="input-field"
                placeholder="Acme Corp"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={createOrgLoading}>
              {createOrgLoading ? 'Creating...' : 'Create Organization'}
            </button>
          </form>

          <button className="btn btn-secondary" style={{ width: '100%', marginTop: '16px' }} onClick={() => signOut()}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const quotaPercent = activeOrg ? Math.min(100, (activeOrg.quota_used / activeOrg.quota_limit) * 100) : 0;

  return (
    <>
      {/* Premium Header */}
      <header className="header">
        <div className="header-inner">
          <div className="brand" onClick={() => router.push('/dashboard')} style={{ cursor: 'pointer' }}>
            AI Agent<span>Workflow</span>
          </div>
          <div className="nav-links">
            <span className="text-muted" style={{ fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              Signed in as: <strong style={{ color: 'white' }}>{user?.displayName || user?.email}</strong>
              {user?.id && (
                <span 
                  onClick={() => {
                    navigator.clipboard.writeText(user.id);
                    setFeedbackMsg('Your User ID copied to clipboard!');
                    setTimeout(() => setFeedbackMsg(''), 3000);
                  }}
                  style={{
                    fontSize: '0.75rem',
                    background: 'rgba(139, 92, 246, 0.2)',
                    color: '#d8b4fe',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    border: '1px solid rgba(139, 92, 246, 0.3)',
                    transition: 'all 0.2s'
                  }}
                  title="Click to copy your User ID for organization invites"
                >
                  Copy ID
                </span>
              )}
            </span>
            <button className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={() => signOut()}>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="app-container">
        {receivedInvites.length > 0 && (
          <div className="glass-card mb-24" style={{ border: '1px solid rgba(139, 92, 246, 0.4)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '12px', color: '#d8b4fe' }}>
              Pending Organization Invitations ({receivedInvites.length})
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {receivedInvites.map((invite: any) => (
                <div key={invite.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.05)', padding: '12px', borderRadius: '8px', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{invite.organization?.name || 'Pending Organization'}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Invited by: {invite.inviter?.displayName || 'Owner'} ({invite.role})
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleRespondToInvite(invite.id, 'accepted')}>
                      Accept
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleRespondToInvite(invite.id, 'declined')}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Org Selector & Status Info */}
        <div className="flex justify-between align-center mb-24" style={{ flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span className="text-muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>
              Active Organization
            </span>
            <div className="flex align-center gap-8">
              <select
                value={selectedOrgIdx}
                onChange={(e) => {
                  setSelectedOrgIdx(Number(e.target.value));
                  setFeedbackMsg('');
                }}
                className="input-field"
                style={{ width: 'auto', padding: '8px 16px', fontWeight: 600, background: 'rgba(0, 0, 0, 0.4)' }}
              >
                {memberships.map((mem: any, idx: number) => (
                  <option key={mem.id} value={idx}>
                    {mem.organization.name}
                  </option>
                ))}
              </select>
              <span className="badge badge-completed" style={{ background: 'var(--primary-glow)', color: '#d8b4fe', border: '1px solid rgba(139,92,246,0.3)' }}>
                Role: {userRole}
              </span>
            </div>
          </div>

          {/* Inline Create Org button if needed */}
          <div className="flex gap-16 align-center">
            <input
              type="text"
              placeholder="New Org Name"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              className="input-field"
              style={{ width: '180px', padding: '8px 12px' }}
            />
            <button className="btn btn-secondary" onClick={handleCreateOrg} style={{ padding: '8px 16px', fontSize: '0.85rem' }} disabled={createOrgLoading}>
              + Create Org
            </button>
          </div>
        </div>

        {/* Global Feedback Panel */}
        {feedbackMsg && (
          <div style={{
            padding: '12px 16px',
            borderRadius: '8px',
            background: 'rgba(139, 92, 246, 0.1)',
            border: '1px solid rgba(139, 92, 246, 0.2)',
            fontSize: '0.85rem',
            marginBottom: '24px',
            color: '#d8b4fe',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>{feedbackMsg}</span>
            <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem' }} onClick={() => setFeedbackMsg('')}>×</button>
          </div>
        )}

        {/* Top Grid: Usage stats & Members panel */}
        <div className="grid grid-cols-2 mb-24">
          {/* Quota limit card */}
          <div className="glass-card flex flex-col justify-between">
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px' }}>Usage Quota</h3>
              <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: '24px' }}>
                Each workflow completion increments your quota. Viewers can monitor, editors and owners can run.
              </p>
            </div>
            
            <div>
              <div className="flex justify-between align-center mb-8" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                <span>RUNS COMPLETED</span>
                <span>{activeOrg?.quota_used} / {activeOrg?.quota_limit}</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  width: `${quotaPercent}%`,
                  height: '100%',
                  background: quotaPercent >= 90 ? 'var(--error)' : 'linear-gradient(90deg, var(--primary) 0%, var(--success) 100%)',
                  borderRadius: '4px',
                  transition: 'width 0.5s ease'
                }} />
              </div>
            </div>
          </div>

          {/* Members list card */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '12px' }}>Organization Members</h3>
            
            <div style={{ maxHeight: '160px', overflowY: 'auto', marginBottom: '16px', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px' }}>
              {activeOrg?.members.map((mem: any) => (
                <div key={mem.id} className="flex justify-between align-center" style={{ padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{mem.user?.displayName || 'Unknown Member'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{mem.user?.email || mem.user_id}</div>
                  </div>
                  <div className="flex align-center gap-8">
                    <span className="badge badge-pending" style={{ fontSize: '0.65rem' }}>{mem.role}</span>
                    {userRole === 'owner' && mem.user_id !== user?.id && (
                      <button
                        onClick={() => handleRemoveMember(mem.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Invite members form (Owner only) */}
            {userRole === 'owner' ? (
              <>
                <form onSubmit={handleInviteMember} className="flex gap-8" style={{ marginTop: '12px' }}>
                  <input
                    type="text"
                    placeholder="Invite user ID (UUID)"
                    value={newMemberId}
                    onChange={(e) => setNewMemberId(e.target.value)}
                    className="input-field"
                    style={{ padding: '8px 12px', fontSize: '0.85rem', flex: 1 }}
                    required
                  />
                  <select
                    value={newMemberRole}
                    onChange={(e) => setNewMemberRole(e.target.value)}
                    className="input-field"
                    style={{ width: 'auto', padding: '8px 12px', fontSize: '0.85rem' }}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button type="submit" className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }} disabled={inviteMemberLoading}>
                    {inviteMemberLoading ? 'Inviting...' : '+ Invite'}
                  </button>
                </form>

                {/* List pending invites sent */}
                {activeOrg?.invites && activeOrg.invites.length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '8px', color: 'var(--text-muted)' }}>Pending Sent Invites</h4>
                    <div style={{ maxHeight: '100px', overflowY: 'auto', border: '1px dotted rgba(255,255,255,0.15)', borderRadius: '6px', padding: '6px' }}>
                      {activeOrg.invites.map((inv: any) => (
                        <div key={inv.id} className="flex justify-between align-center" style={{ padding: '6px', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {inv.invited_user?.displayName || 'Pending User'}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{inv.invited_user?.email || inv.invited_user_id}</div>
                          </div>
                          <div className="flex align-center gap-8">
                            <span className="badge badge-pending" style={{ fontSize: '0.6rem', padding: '2px 6px' }}>{inv.role}</span>
                            <button
                              onClick={() => handleCancelInvite(inv.id)}
                              style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: '0.75rem', padding: '2px' }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted text-center" style={{ fontSize: '0.8rem', fontStyle: 'italic' }}>
                Only organization Owners can manage members.
              </p>
            )}
          </div>
        </div>

        {/* Workflows List panel */}
        <div className="glass-card mb-24">
          <div className="flex justify-between align-center mb-24">
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Workflows</h3>
            {userRole !== 'viewer' && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  const element = document.getElementById('create-workflow-section');
                  element?.scrollIntoView({ behavior: 'smooth' });
                }}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              >
                + New Workflow
              </button>
            )}
          </div>

          {activeOrg?.workflows.length === 0 ? (
            <div className="text-center p-24 text-muted">
              No workflows created yet. Click "New Workflow" to build your first automation step.
            </div>
          ) : (
            <div className="table-container">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>DESCRIPTION</th>
                    <th>LAST RUN STATUS</th>
                    <th>CREATED AT</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrg?.workflows.map((wf: any) => {
                    const lastRun = wf.runs?.[0];
                    return (
                      <tr key={wf.id}>
                        <td>
                          <span
                            onClick={() => router.push(`/workflows/${wf.id}`)}
                            style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--primary)', textDecoration: 'underline' }}
                          >
                            {wf.name}
                          </span>
                        </td>
                        <td className="text-muted" style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {wf.description || 'No description'}
                        </td>
                        <td>
                          <span className={`badge ${getStatusBadgeClass(lastRun?.status)}`}>
                            {lastRun ? lastRun.status : 'no runs'}
                          </span>
                        </td>
                        <td className="text-muted">
                          {new Date(wf.created_at).toLocaleDateString()}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '8px' }}>
                            <button
                              onClick={() => router.push(`/workflows/${wf.id}`)}
                              className="btn btn-secondary"
                              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                            >
                              Edit Step Builder
                            </button>
                            {lastRun && (
                              <button
                                onClick={() => router.push(`/runs/${lastRun.id}`)}
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                              >
                                View Last Run
                              </button>
                            )}
                            {userRole === 'owner' && (
                              <button
                                onClick={() => handleDeleteWorkflow(wf.id)}
                                className="btn btn-danger"
                                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Create Workflow Panel (Owners and Editors only) */}
        {userRole !== 'viewer' && (
          <div id="create-workflow-section" className="glass-card" style={{ maxWidth: '600px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px' }}>Create New Workflow</h3>
            <form onSubmit={handleCreateWorkflow}>
              <div className="form-group">
                <label className="form-label">Workflow Name</label>
                <input
                  type="text"
                  placeholder="Customer Refund Agent"
                  value={newWorkflowName}
                  onChange={(e) => setNewWorkflowName(e.target.value)}
                  className="input-field"
                  required
                />
              </div>
              <div className="form-group" style={{ marginBottom: '24px' }}>
                <label className="form-label">Description</label>
                <textarea
                  placeholder="Classify customer query using AI and route refunds for approval."
                  value={newWorkflowDesc}
                  onChange={(e) => setNewWorkflowDesc(e.target.value)}
                  className="input-field"
                  style={{ minHeight: '80px', fontFamily: 'inherit' }}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={createWfLoading}>
                {createWfLoading ? 'Creating...' : 'Create Workflow'}
              </button>
            </form>
          </div>
        )}
      </main>
    </>
  );
}
