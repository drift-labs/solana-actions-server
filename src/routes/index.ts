import express from 'express';
import blinksRouter from './blinks.js';
import transactionsRouter from './transactions.js';

const app = express();

app.use('/blinks', blinksRouter);
app.use('/transactions', transactionsRouter);

export default app;
