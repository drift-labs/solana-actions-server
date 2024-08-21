import {
	DRIFT_PROGRAM_ID,
	getInsuranceFundStakeAccountPublicKey,
	PollingInsuranceFundStakeAccountSubscriber,
	PublicKey,
} from '@drift-labs/sdk';
import express, { Request, Response } from 'express';
import { createDriftClient, returnErrorResponse } from '../utils/index.js';

const router = express.Router();

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

	const DRIFT_SPOT_MARKET_INDEX = 15;
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

	console.log(
		ifStakeAccSubscriber.insuranceFundStakeAccountAndSlot.data.ifShares.toNumber()
	);

	res.json('ok');
});

export default router;
