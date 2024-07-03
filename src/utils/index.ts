import {
	DriftClient,
	PublicKey,
	ReferrerInfo,
	SpotMarketConfig,
	WRAPPED_SOL_MINT,
} from '@drift-labs/sdk';
import { getAssociatedTokenAddress } from '@solana/spl-token';

export const getTokenAddressForDepositAndWithdraw = async (
	spotMarket: SpotMarketConfig,
	authority: PublicKey
) => {
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
