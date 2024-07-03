import {
	DriftClient,
	IWallet,
	PublicKey,
	ReferrerInfo,
	SpotMarketConfig,
	WRAPPED_SOL_MINT,
} from '@drift-labs/sdk';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { Keypair } from '@solana/web3.js';

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
