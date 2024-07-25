import { MainnetSpotMarkets } from '@drift-labs/sdk';

export const ELECTIONS_CTA_SOL_AMOUNT = [0.1, 0.5];
export const SUPPORTED_ELECTION_TOKENS = [
	{
		token: 'KAMA',
		mint: 'HnKkzR1YtFbUUxM6g3iVRS2RY68KHhGV7bNdfF1GCsJB',
	},
	{
		token: 'TREMP',
		mint: 'FU1q8vJpZNUrmqsciSjp8bAKKidGsLmouB8CBdf8TKQv',
	},
];
export const ELECTIONS_GENERIC_CTA = SUPPORTED_ELECTION_TOKENS.map((token) => {
	return ELECTIONS_CTA_SOL_AMOUNT.map((solAmount) => {
		return {
			token: token.token,
			solAmount,
		};
	});
}).flat();
export const SWAP_FROM_TOKEN = MainnetSpotMarkets[1]; // SOL market
export const DEFAULT_SLIPPAGE_BPS = 50;
