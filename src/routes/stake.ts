import {
	DRIFT_PROGRAM_ID,
	getInsuranceFundStakeAccountPublicKey,
	MainnetSpotMarkets,
	PollingInsuranceFundStakeAccountSubscriber,
	PublicKey,
} from '@drift-labs/sdk';
import express, { Request, Response } from 'express';
import { createDriftClient, returnErrorResponse } from '../utils/index.js';

const router = express.Router();

const REQUIRED_DRIFT_AMOUNT = 1000; // used for Solana Breakpoint car-riding booking requirement
const DRIFT_SPOT_MARKET_INDEX = 15;
const driftPrecision =
	MainnetSpotMarkets[DRIFT_SPOT_MARKET_INDEX].precision.toNumber();
const ESTIMATED_DRIFT_VALUE_MULTIPLIER = 1.0002;

router.get('/drift', async (req: Request, res: Response) => {
	let authority: PublicKey | undefined;

	try {
		authority = new PublicKey(req.query.wallet);
	} catch (err) {
		// do nothing
	}

	if (!authority) {
		return returnErrorResponse(res, 'Invalid wallet');
	}

	const userDriftIFStakeAccountPubKey = getInsuranceFundStakeAccountPublicKey(
		new PublicKey(DRIFT_PROGRAM_ID),
		authority,
		DRIFT_SPOT_MARKET_INDEX
	);
	const { driftClient, accountLoader } = createDriftClient(req);
	const driftProgram = driftClient.program;

	const ifStakeAccSubscriber = new PollingInsuranceFundStakeAccountSubscriber(
		driftProgram,
		userDriftIFStakeAccountPubKey,
		accountLoader
	);

	await ifStakeAccSubscriber.fetch();

	const ifShares =
		ifStakeAccSubscriber.insuranceFundStakeAccountAndSlot?.data.ifShares.toNumber() ??
		0;

	const estimatedDriftValue =
		(ifShares * ESTIMATED_DRIFT_VALUE_MULTIPLIER) / driftPrecision;

	const isEligible = estimatedDriftValue >= REQUIRED_DRIFT_AMOUNT;

	res.json({ ifShares, estimatedDriftValue, isEligible });
});

export default router;
