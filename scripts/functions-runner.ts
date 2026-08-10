// scripts/functions-runner.ts

import express from 'express';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.FUNCTIONS_PORT || 5001;

app.use(express.json());

// Enable CORS for local web development
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Import endpoints dynamically
import approveStepHandler from '../functions/approve-step';
import triggerWorkflowRunHandler from '../functions/trigger-workflow-run';
import notificationHandler from '../functions/notification';

// Routes mapping Nhost conventions
app.post('/v1/functions/approve-step', async (req, res) => {
  try {
    await approveStepHandler(req, res);
  } catch (err: any) {
    console.error('Error in approve-step function:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
});

app.post('/v1/functions/trigger-workflow-run', async (req, res) => {
  try {
    await triggerWorkflowRunHandler(req, res);
  } catch (err: any) {
    console.error('Error in trigger-workflow-run function:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
});

app.post('/v1/functions/notification', async (req, res) => {
  try {
    await notificationHandler(req, res);
  } catch (err: any) {
    console.error('Error in notification function:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Nhost local functions runner listening at:`);
  console.log(`http://localhost:${PORT}`);
  console.log(`GraphQL endpoint: ${process.env.NHOST_GRAPHQL_URL}`);
  console.log(`==================================================`);
});
