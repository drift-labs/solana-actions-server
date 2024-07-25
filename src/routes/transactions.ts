import express, { Request, Response } from 'express';
import { ActionsSpecPostResponse } from '../types/solana-actions';
import {
	Connection,
	PublicKey,
	Transaction,
	VersionedTransaction,
} from '@solana/web3.js';
import {
	BN,
	DriftEnv,
	SpotMarkets,
	getMarketsAndOraclesForSubscription,
	DRIFT_PROGRAM_ID,
	DriftClient,
	BulkAccountLoader,
	JupiterClient,
} from '@drift-labs/sdk';
import {
	clamp,
	createThrowawayIWallet,
	getHeliusPriorityFees,
	getReferrerInfo,
	getTokenAddressForDepositAndWithdraw,
	returnErrorResponse,
	uint8ArrayToBase64,
} from '../utils/index.js';
import { PostHogClient } from '../posthog.js';
import { POSTHOG_EVENTS } from '../constants/posthog.js';
import {
	DEFAULT_SLIPPAGE_BPS,
	SUPPORTED_ELECTION_TOKENS,
	SWAP_FROM_TOKEN,
} from '../constants/elections.js';

const router = express.Router();

const ENDPOINT = process.env.ENDPOINT ?? '';
const DRIFT_ENV = (process.env.ENV || 'devnet') as DriftEnv;
const DRIFT_MAIN_APP_URL = 'https://app.drift.trade';

router.post('/deposit', async (req: Request, res: Response) => {
	const utmObject = req.query.utm_source
		? {
				utm_source: req.query.utm_source,
				utm_medium: req.query.utm_medium,
				utm_campaign: req.query.utm_campaign,
				utm_term: req.query.utm_term,
				utm_content: req.query.utm_content,
		  }
		: {};

	const restOfQueryParams = { ...req.query };
	delete restOfQueryParams.utm_source;
	delete restOfQueryParams.utm_medium;
	delete restOfQueryParams.utm_campaign;
	delete restOfQueryParams.utm_term;
	delete restOfQueryParams.utm_content;

	PostHogClient.capture({
		distinctId: req.ip,
		event: POSTHOG_EVENTS.createDepositTransaction,
		properties: {
			txnQueryParams: restOfQueryParams,
			authority: req.body.account,
			amount: req.query.amount,
			token: req.query.token,
			referralCode: req.query.ref,
			...utmObject,
		},
	});

	let authority: PublicKey | undefined;

	try {
		authority = new PublicKey(req.body.account);
	} catch (err) {
		// do nothing
	}

	if (!authority) {
		return returnErrorResponse(res, 'Invalid account');
	}

	const token = req.query.token;
	const depositSpotMarketConfig = SpotMarkets[DRIFT_ENV].find(
		(config) => config.symbol === token
	);

	if (!depositSpotMarketConfig) {
		return returnErrorResponse(res, 'Invalid token');
	}

	const amountString = req.query.amount as string;
	if (isNaN(+amountString)) {
		return returnErrorResponse(res, 'Invalid amount');
	}
	const amountBn = new BN(
		+amountString * depositSpotMarketConfig.precision.toNumber()
	);

	const priorityFeePromise = getHeliusPriorityFees();
	const { oracleInfos, perpMarketIndexes, spotMarketIndexes } =
		getMarketsAndOraclesForSubscription(DRIFT_ENV);

	const connection = new Connection(ENDPOINT, {
		commitment: 'confirmed',
	});

	const bulkAccountLoader = new BulkAccountLoader(connection, 'confirmed', 0);

	const walletWrapper = createThrowawayIWallet();

	walletWrapper.publicKey = authority;
	const driftClient = new DriftClient({
		connection: connection,
		wallet: walletWrapper,
		programID: new PublicKey(DRIFT_PROGRAM_ID),
		env: DRIFT_ENV,
		txVersion: 0,
		userStats: false,
		perpMarketIndexes: perpMarketIndexes,
		spotMarketIndexes: spotMarketIndexes,
		oracleInfos: oracleInfos,
		accountSubscription: {
			type: 'polling',
			accountLoader: bulkAccountLoader,
		},
	});

	try {
		if (!driftClient.isSubscribed) {
			const subscriptionResult = await driftClient.subscribe();
			if (!subscriptionResult) {
				return returnErrorResponse(res, 'Failed to subscribe to Drift Client');
			}
		}
	} catch (err) {
		return returnErrorResponse(res, 'Failed to subscribe to Drift Client');
	}
	const referralCode = (req.query.ref as string) ?? '';

	const [userAccounts, tokenAccount, referralInfo] = await Promise.all([
		driftClient.getUserAccountsForAuthority(authority),
		getTokenAddressForDepositAndWithdraw(depositSpotMarketConfig, authority),
		referralCode ? getReferrerInfo(driftClient, referralCode) : undefined,
	]);

	let txn: Transaction | VersionedTransaction;

	const computeUnitsPrice = clamp(
		Math.round(await priorityFeePromise),
		50_000,
		1_000_000
	);

	if (userAccounts.length === 0) {
		// if don't have Drift account, create initialize and deposit transaction
		[txn] = await driftClient.createInitializeUserAccountAndDepositCollateral(
			amountBn,
			tokenAccount,
			depositSpotMarketConfig.marketIndex,
			0,
			undefined,
			undefined,
			referralInfo, // referrer info
			undefined,
			{
				computeUnits: 200_000,
				computeUnitsPrice: computeUnitsPrice,
			}
		);
	} else {
		// if have Drift account, create deposit transaction
		const firstUserAccount = userAccounts[0];

		await driftClient.switchActiveUser(firstUserAccount.subAccountId);

		txn = await driftClient.createDepositTxn(
			amountBn,
			depositSpotMarketConfig.marketIndex,
			tokenAccount,
			firstUserAccount.subAccountId,
			false,
			{
				computeUnits: 100_000,
				computeUnitsPrice: computeUnitsPrice,
			}
		);
	}

	const actionResponse: ActionsSpecPostResponse = {
		transaction: uint8ArrayToBase64(txn.serialize()),
		message: `Successfully deposited ${token}. Visit ${DRIFT_MAIN_APP_URL} to view your deposit.`,
	};

	driftClient.unsubscribe();

	return res.json(actionResponse);
});

router.post('/elections', async (req: Request, res: Response) => {
	const utmObject = req.query.utm_source
		? {
				utm_source: req.query.utm_source,
				utm_medium: req.query.utm_medium,
				utm_campaign: req.query.utm_campaign,
				utm_term: req.query.utm_term,
				utm_content: req.query.utm_content,
		  }
		: {};

	const restOfQueryParams = { ...req.query };
	delete restOfQueryParams.utm_source;
	delete restOfQueryParams.utm_medium;
	delete restOfQueryParams.utm_campaign;
	delete restOfQueryParams.utm_term;
	delete restOfQueryParams.utm_content;

	PostHogClient.capture({
		distinctId: req.ip,
		event: POSTHOG_EVENTS.createElectionsSwapTransaction,
		properties: {
			txnQueryParams: restOfQueryParams,
			authority: req.body.account,
			amount: req.query.amount,
			token: req.query.token,
			...utmObject,
		},
	});
	let authority: PublicKey | undefined;

	try {
		authority = new PublicKey(req.body.account);
	} catch (err) {
		// do nothing
	}

	if (!authority) {
		return returnErrorResponse(res, 'Invalid account');
	}

	const token = req.query.token;
	const amount = req.query.amount;

	const electionToken = SUPPORTED_ELECTION_TOKENS.find(
		(supportedToken) => supportedToken.token === token
	);
	const isValidAmount = amount && !isNaN(+amount);

	if (!token || !electionToken) {
		return returnErrorResponse(res, 'Invalid token');
	}
	if (!isValidAmount) {
		return returnErrorResponse(res, 'Invalid amount');
	}

	const connection = new Connection(ENDPOINT, {
		commitment: 'confirmed',
	});
	const jupiterClient = new JupiterClient({
		connection: connection,
	});

	const numericSwapAmount = +amount * SWAP_FROM_TOKEN.precision.toNumber();

	// get quote
	const quote = await jupiterClient.getQuote({
		inputMint: SWAP_FROM_TOKEN.mint,
		outputMint: new PublicKey(electionToken.mint),
		amount: new BN(numericSwapAmount),
		slippageBps: DEFAULT_SLIPPAGE_BPS,
		swapMode: 'ExactIn',
	});

	// create transaction
	const transaction = await jupiterClient.getSwap({
		quote,
		userPublicKey: authority,
		slippageBps: quote.slippageBps,
	});

	const actionResponse: ActionsSpecPostResponse = {
		transaction: uint8ArrayToBase64(transaction.serialize()),
		message: `Successfully swapped ${amount} ${token}!`,
	};

	return res.json(actionResponse);
});

export default router;
