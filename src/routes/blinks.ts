import express, { Request, Response } from 'express';
import { ActionGetResponse } from '@solana/actions';
import { Connection, PublicKey } from '@solana/web3.js';
import {
	DriftEnv,
	SpotMarkets,
	getMarketsAndOraclesForSubscription,
	DRIFT_PROGRAM_ID,
	DriftClient,
	BulkAccountLoader,
	calculateDepositRate,
	convertToNumber,
	BN,
} from '@drift-labs/sdk';
import { createThrowawayIWallet } from '../utils/index.js';
import { PostHogClient } from '../posthog.js';
import { POSTHOG_EVENTS } from '../constants/posthog.js';
import {
	ELECTIONS_CTA_SOL_AMOUNT,
	ELECTIONS_GENERIC_CTA,
	SUPPORTED_ELECTION_TOKENS,
} from '../constants/elections.js';

const router = express.Router();

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

router.get('/', (req: Request, res: Response) => {
	PostHogClient.capture({
		distinctId: req.ip,
		event: POSTHOG_EVENTS.redirectFromActionsServerToMainApp,
	});

	res.redirect(DRIFT_MAIN_APP_URL);
});

router.get('/deposit', async (req: Request, res: Response) => {
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

	const { oracleInfos, perpMarketIndexes, spotMarketIndexes } =
		getMarketsAndOraclesForSubscription(DRIFT_ENV);

	const connection = new Connection(ENDPOINT, {
		commitment: 'confirmed',
	});

	const bulkAccountLoader = new BulkAccountLoader(connection, 'confirmed', 0);

	const walletWrapper = createThrowawayIWallet();

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
	await driftClient.subscribe();

	let title = `Deposit ${depositToken} into Drift`;

	const spotMarket = driftClient.getSpotMarketAccount(
		spotMarketConfig.marketIndex
	);

	if (spotMarket) {
		const apr = convertToNumber(
			calculateDepositRate(spotMarket),
			new BN(10000)
		);

		if (apr >= 0.1) {
			title = `Deposit ${depositToken} into Drift and earn ${apr.toFixed(
				2
			)}% APR`;
		}
	}

	const label = '';
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

	const links: ActionGetResponse['links'] = {
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

	const response: ActionGetResponse = {
		icon,
		label,
		title,
		description,
		disabled,
		links,
	};

	driftClient.unsubscribe();

	return res.json(response);
});

router.get('/elections', async (req: Request, res: Response) => {
	// posthog
	PostHogClient.capture({
		distinctId: req.ip,
		event: POSTHOG_EVENTS.depositBlinkView,
		properties: {
			blinkQueryParams: req.query,
		},
	});

	const electionToken = req.query.token as string;

	const isValidToken = SUPPORTED_ELECTION_TOKENS.some(
		(token) => token.token.toLowerCase() === electionToken?.toLowerCase()
	);

	const transactionsRoute = `${HOST}/transactions/elections`;
	const title = 'Election Center';
	let label = '';
	const description = '';
	const disabled = false;

	// handle no/invalid token
	if (!electionToken || !isValidToken) {
		const icon = `${BLINKS_S3_DRIFT_PUBLIC_BUCKET}/elections-generic.webp`;

		const ctaActionButtons = ELECTIONS_GENERIC_CTA.map((config) => {
			return {
				href: `${transactionsRoute}?token=${config.token}&amount=${config.solAmount}`,
				label: `Buy ${config.solAmount} SOL / ${config.token}`,
			};
		});

		const response: ActionGetResponse = {
			icon,
			label,
			title,
			description,
			disabled,
			links: {
				actions: ctaActionButtons,
			},
		};

		return res.json(response);
	}

	// handle valid tokens
	label = `Swap for ${electionToken.toUpperCase()} now`;
	const icon = `${BLINKS_S3_DRIFT_PUBLIC_BUCKET}/elections-${electionToken.toLowerCase()}.webp`;
	const amountQueryKey = 'depositAmount';

	const ctaActionButtons = ELECTIONS_CTA_SOL_AMOUNT.map((solAmount) => {
		return {
			href: `${transactionsRoute}?token=${electionToken}&amount=${solAmount}`,
			label: `Buy with ${solAmount} SOL`,
		};
	});

	const response: ActionGetResponse = {
		icon,
		label,
		title,
		description,
		disabled,
		links: {
			actions: [
				...ctaActionButtons,
				{
					href: `${transactionsRoute}?token=${electionToken}&amount={${amountQueryKey}}`,
					label: `Buy ${electionToken}`,
					parameters: [
						{
							name: amountQueryKey,
							label: `SOL amount`,
						},
					],
				},
			],
		},
	};

	return res.json(response);
});

export default router;
