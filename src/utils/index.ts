import {
	BulkAccountLoader,
	DRIFT_PROGRAM_ID,
	DriftClient,
	getMarketsAndOraclesForSubscription,
	IWallet,
	PublicKey,
	ReferrerInfo,
	SpotMarketConfig,
	WRAPPED_SOL_MINT,
} from '@drift-labs/sdk';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { Connection, Keypair } from '@solana/web3.js';
import { ActionError } from '@solana/actions';
import { Request, Response } from 'express';
import { DEVNET_ENDPOINT, ENDPOINT } from '../constants/environment.js';
import { DRIFT_ENV } from '../config.js';

export const getTokenAddressForDepositAndWithdraw = async (
	spotMarket: SpotMarketConfig,
	authority: PublicKey
): Promise<PublicKey> => {
	const isSol = spotMarket.mint.equals(WRAPPED_SOL_MINT);

	return isSol
		? authority
		: await getAssociatedTokenAddress(spotMarket.mint, authority, true);
};

export const getReferrerInfo = async (
	driftClient: DriftClient,
	referrerName: string
): Promise<ReferrerInfo> => {
	let referrerInfo: ReferrerInfo = undefined;

	if (!driftClient || !driftClient.isSubscribed) return undefined;

	if (referrerName) {
		try {
			const referrerNameAccount = await driftClient.fetchReferrerNameAccount(
				referrerName
			);

			if (referrerNameAccount) {
				referrerInfo = {
					referrer: referrerNameAccount.user,
					referrerStats: referrerNameAccount.userStats,
				};
			}
		} catch (err) {
			// We should never get here because we check if the referrer is valid when loading the page
			console.log(err);
			return undefined;
		}
	}

	return referrerInfo;
};

export const createThrowawayIWallet = (walletPubKey?: PublicKey): IWallet => {
	const newKeypair = walletPubKey
		? new Keypair({
				publicKey: walletPubKey.toBytes(),
				secretKey: new Keypair().publicKey.toBytes(),
		  })
		: new Keypair();

	const newWallet: IWallet = {
		publicKey: newKeypair.publicKey,
		//@ts-ignore
		signTransaction: () => {
			return Promise.resolve();
		},
		//@ts-ignore
		signAllTransactions: () => {
			return Promise.resolve();
		},
	};

	return newWallet;
};

export const uint8ArrayToBase64 = (uint8Array: Uint8Array): string => {
	return Buffer.from(uint8Array).toString('base64');
};

const PRIORITY_FEE_SUBSCRIPTION_ADDRESSES = [
	DRIFT_PROGRAM_ID.toString(),
	'8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6', // sol openbook market
	'8UJgxaiQx5nTrdDgph5FiahMmzduuLTLf5WmsPegYA6W', // sol perp
	'6gMq3mRCKf8aP3ttTyYhuijVZ2LGi14oDsBbkgubfLB3', // usdc
];
export const getHeliusPriorityFees = async (): Promise<number> => {
	const HELIUS_RPC = process.env.HELIUS_RPC_URL;

	if (!HELIUS_RPC || !HELIUS_RPC.includes('helius')) {
		return 0;
	}

	try {
		const response = await fetch(HELIUS_RPC, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: '1',
				method: 'getPriorityFeeEstimate',
				params: [
					{
						accountKeys: PRIORITY_FEE_SUBSCRIPTION_ADDRESSES,
						options: {
							includeAllPriorityFeeLevels: true,
						},
					},
				],
			}),
		});
		const data = await response.json();

		return data.result.priorityFeeLevels.high;
	} catch (err) {
		console.log(err);
		return 0;
	}
};

export const clamp = (value: number, min: number, max: number): number => {
	return Math.max(min, Math.min(max, value));
};

export const returnErrorResponse = (res: Response, message: string) => {
	return res.status(400).json({ message } as ActionError);
};

export const getEnvEndpointFromRequest = (req: Request): string => {
	if (req.query.devnet === 'true') {
		return DEVNET_ENDPOINT;
	}

	return ENDPOINT;
};

export const createDriftClient = (req: Request, authority?: PublicKey) => {
	const connection = new Connection(getEnvEndpointFromRequest(req), {
		commitment: 'confirmed',
	});
	const walletWrapper = createThrowawayIWallet();
	if (authority) {
		walletWrapper.publicKey = authority;
	}

	const { oracleInfos, perpMarketIndexes, spotMarketIndexes } =
		getMarketsAndOraclesForSubscription(DRIFT_ENV);
	const bulkAccountLoader = new BulkAccountLoader(connection, 'confirmed', 0);

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

	return { driftClient, connection, accountLoader: bulkAccountLoader };
};
