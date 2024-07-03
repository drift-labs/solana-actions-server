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
	Keypair,
} from '@solana/web3.js';
import {
	BN,
	DriftEnv,
	SpotMarkets,
	getMarketsAndOraclesForSubscription,
	DRIFT_PROGRAM_ID,
	DriftClient,
	BulkAccountLoader,
	Wallet,
} from '@drift-labs/sdk';
import {
	getReferrerInfo,
	getTokenAddressForDepositAndWithdraw,
} from '../utils/index.js';

const BLINKS_S3_DRIFT_PUBLIC_BUCKET = process.env.BUCKET ?? '';
const ENDPOINT = process.env.ENDPOINT ?? '';
const DRIFT_ENV = (process.env.ENV || 'devnet') as DriftEnv;
const PORT = process.env.PORT || 3000;
const HOST =
	process.env.NODE_ENV === 'development'
		? `http://localhost:${PORT}`
		: process.env.URL;

const router = express.Router();

router.get('/blinks/deposit', (req: Request, res: Response) => {
	const depositToken = (req.query.token ?? 'USDC') as string;
	const referralCode = (req.query.ref ?? undefined) as string;

	const spotMarketConfig = SpotMarkets[DRIFT_ENV].find(
		(market) => market.symbol === depositToken
	);

	if (!spotMarketConfig) {
		return res.status(400).json({ message: 'Invalid token' });
	}

	const icon = `${BLINKS_S3_DRIFT_PUBLIC_BUCKET}/deposit-${
		depositToken === 'USDC'
			? 'usdc'
			: depositToken === 'JLP'
			? 'jlp'
			: 'generic'
	}.webp`;

	const label = '';
	const title = `Deposit ${depositToken} into Drift`;
	const description = '';
	const disabled = false;
	const amountQuery = 'depositAmount';

	const queryParamsObject: Record<string, string> = {
		token: depositToken,
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

	const { oracleInfos, perpMarketIndexes, spotMarketIndexes } =
		getMarketsAndOraclesForSubscription(DRIFT_ENV);

	const connection = new Connection(ENDPOINT, {
		commitment: 'confirmed',
	});

	const bulkAccountLoader = new BulkAccountLoader(
		connection,
		'confirmed',
		60 * 1000
	);

	const wallet = new Wallet(
		new Keypair({
			publicKey: authority.toBytes(),
			secretKey: new Keypair().publicKey.toBytes(),
		})
	);

	const driftClient = new DriftClient({
		connection: connection,
		wallet,
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

	const subscriptionResult = await driftClient.subscribe();
	if (!subscriptionResult) {
		return returnErrorResponse('Failed to subscribe to Drift Client');
	}

	const referralCode = (req.query.ref as string) ?? '';

	// check if wallet has a Drift user account
	const [userAccounts, tokenAccount, referralInfo] = await Promise.all([
		driftClient.getUserAccountsForAuthority(authority),
		getTokenAddressForDepositAndWithdraw(depositSpotMarketConfig, authority),
		referralCode ? getReferrerInfo(driftClient, referralCode) : undefined,
	]);

	let txn: Transaction | VersionedTransaction;

	if (userAccounts.length === 0) {
		// if don't have Drift account, create initialize and deposit transaction
		// [txn] = await driftClient.createInitializeUserAccountAndDepositCollateral(
		// 	amountBn,
		// 	tokenAccount,
		// 	depositSpotMarketConfig.marketIndex,
		// 	0,
		// 	undefined,
		// 	undefined,
		// 	referralInfo, // referrer info
		// 	undefined,
		// 	{
		// 		computeUnits: 200_000,
		// 		computeUnitsPrice: 100_000,
		// 	}
		// );
	} else {
		// if have Drift account, create deposit transaction
		const firstUserAccount = userAccounts[0];

		await driftClient.switchActiveUser(firstUserAccount.subAccountId);

		// txn = await driftClient.createDepositTxn(
		// 	amountBn,
		// 	depositSpotMarketConfig.marketIndex,
		// 	tokenAccount,
		// 	firstUserAccount.subAccountId,
		// 	false,
		// 	{
		// 		computeUnits: 100_000,
		// 		computeUnitsPrice: 100_000,
		// 	}
		// );
	}

	const response: ActionsSpecPostResponse = {
		transaction: txn.serialize().toString('base64'),
		message: `Successfully deposited ${token}. Visit https://app.drift.trade to view your deposit.`,
	};

	return res.json(response);
});

export default router;
