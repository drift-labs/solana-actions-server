import express, { Request, Response } from 'express';
import {
	ActionsSpecGetResponse,
	ActionsSpecPostResponse,
	ActionsSpecErrorResponse,
} from '../types/solana-actions';
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
} from '@drift-labs/sdk';
import {
	clamp,
	createThrowawayIWallet,
	getHeliusPriorityFees,
	getReferrerInfo,
	getTokenAddressForDepositAndWithdraw,
	uint8ArrayToBase64,
} from '../utils/index.js';
import { PostHogClient } from '../posthog.js';
import { POSTHOG_EVENTS } from '../constants/posthog.js';

const BLINKS_S3_DRIFT_PUBLIC_BUCKET = process.env.BUCKET ?? '';
const GENERIC_BLINK_IMAGE = `${BLINKS_S3_DRIFT_PUBLIC_BUCKET}/deposit-generic.webp`;
const ENDPOINT = process.env.ENDPOINT ?? '';
const DRIFT_ENV = (process.env.ENV || 'devnet') as DriftEnv;
const PORT = process.env.PORT || 3000;
const HOST =
	process.env.NODE_ENV === 'development'
		? `http://localhost:${PORT}`
		: process.env.URL;
const DRIFT_MAIN_APP_URL = 'https://app.drift.trade';

const router = express.Router();

router.get('/', (req: Request, res: Response) => {
	PostHogClient.capture({
		distinctId: req.ip,
		event: POSTHOG_EVENTS.redirectFromActionsServerToMainApp,
	});

	res.redirect(DRIFT_MAIN_APP_URL);
});

router.get('/blinks/deposit', async (req: Request, res: Response) => {
	const depositToken = (req.query.token ?? 'USDC') as string;
	const referralCode = (req.query.ref ?? undefined) as string;

	PostHogClient.capture({
		distinctId: req.ip,
		event: POSTHOG_EVENTS.depositBlinkView,
		properties: {
			blinkQueryParams: req.query,
			depositToken,
			referralCode,
		},
	});

	const spotMarketConfig = SpotMarkets[DRIFT_ENV].find(
		(market) => market.symbol === depositToken
	);

	if (!spotMarketConfig) {
		return res.status(400).json({ message: 'Invalid token' });
	}

	let icon = `${BLINKS_S3_DRIFT_PUBLIC_BUCKET}/deposit-${depositToken.toLowerCase()}.webp`;

	try {
		const response = await fetch(icon);
		if (!response.ok) {
			icon = GENERIC_BLINK_IMAGE;
		}
	} catch (err) {
		icon = GENERIC_BLINK_IMAGE;
	}

	const label = '';
	const title = `Deposit ${depositToken} into Drift`;
	const description = '';
	const disabled = false;
	const amountQuery = 'depositAmount';

	const queryParamsObject: Record<string, string> = {
		token: depositToken,
		...req.query,
	};

	if (referralCode) {
		queryParamsObject.ref = referralCode;
	}

	const queryParams = new URLSearchParams(queryParamsObject).toString();

	const links: ActionsSpecGetResponse['links'] = {
		actions: [
			{
				href: `${HOST}/transactions/deposit?${queryParams}&amount={${amountQuery}}`,
				label: 'Deposit into Drift',
				parameters: [
					{
						name: amountQuery,
						label: `${depositToken} amount to deposit`,
					},
				],
			},
		],
	};

	const response: ActionsSpecGetResponse = {
		icon,
		label,
		title,
		description,
		disabled,
		links,
	};

	return res.json(response);
});

router.post('/transactions/deposit', async (req: Request, res: Response) => {
	const returnErrorResponse = (message: string) => {
		return res.status(400).json({ message } as ActionsSpecErrorResponse);
	};

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
		return returnErrorResponse('Invalid account');
	}

	const token = req.query.token;
	const depositSpotMarketConfig = SpotMarkets[DRIFT_ENV].find(
		(config) => config.symbol === token
	);

	if (!depositSpotMarketConfig) {
		return returnErrorResponse('Invalid token');
	}

	const amountString = req.query.amount as string;
	if (isNaN(+amountString)) {
		return returnErrorResponse('Invalid amount');
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
				return returnErrorResponse('Failed to subscribe to Drift Client');
			}
		}
	} catch (err) {
		return returnErrorResponse('Failed to subscribe to Drift Client');
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

export default router;
