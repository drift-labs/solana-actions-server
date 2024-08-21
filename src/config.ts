import { DriftEnv } from '@drift-labs/sdk';
import dotenv from 'dotenv';
dotenv.config();

export const DRIFT_ENV = (process.env.ENV || 'devnet') as DriftEnv;
