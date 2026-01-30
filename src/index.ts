import express from 'express';
import dotenv from 'dotenv';
import { webhookHandler } from './webhook/handler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post('/webhook', webhookHandler);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`MergeSense listening on port ${PORT}`);
});
