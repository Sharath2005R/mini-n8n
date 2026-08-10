// functions/notification.ts

import type { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const event = req.body?.event;
    if (!event) {
      return res.status(400).json({ success: false, message: 'Missing event payload' });
    }

    const { op, data } = event;
    if (op !== 'INSERT') {
      return res.status(200).json({ success: true, message: 'Only INSERT operation triggers notification' });
    }

    const newRow = data.new;
    console.log('--------------------------------------------------');
    console.log(`[NOTIFICATION RECEIVED]`);
    console.log(`Result ID: ${newRow.id}`);
    console.log(`Workflow Run ID: ${newRow.workflow_run_id}`);
    console.log(`Workflow ID: ${newRow.workflow_id}`);
    console.log('Result payload:', JSON.stringify(newRow.result, null, 2));
    console.log('--------------------------------------------------');

    // Simulate sending notification (email / webhook / slack)
    // Here we just write to standard out (logged notification)
    return res.status(200).json({
      success: true,
      message: `Notification logged for result: ${newRow.id}`
    });

  } catch (error: any) {
    console.error('Notification trigger error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}
