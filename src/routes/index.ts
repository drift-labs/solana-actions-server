import express from 'express';
import blinksRouter from './blinks.js';
import transactionsRouter from './transactions.js';
import stakeRouter from './stake.js';

const app = express();

app.use('/blinks', blinksRouter);
app.use('/transactions', transactionsRouter);
app.use('/stake', stakeRouter);

export default app;
