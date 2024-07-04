import { PostHog } from 'posthog-node';

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;

if (!POSTHOG_API_KEY) {
	console.warn(
		'PostHog API key not found. PostHog client will not be initialized.'
	);
}

export const PostHogClient = POSTHOG_API_KEY
	? new PostHog(POSTHOG_API_KEY, {
			host: 'https://us.i.posthog.com',
	  })
	: undefined;
