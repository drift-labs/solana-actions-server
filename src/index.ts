import './config.js';
import { PostHogClient } from './posthog.js';

import express, { Express } from 'express';
import morgan from 'morgan';
import cors from 'cors';
import api from './routes/index.js';

const PORT = process.env.PORT || 3000;

const app: Express = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(
	morgan(
		':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] :response-time ms ":referrer" ":user-agent"'
	)
);
app.use('/', api);

const checkConnections = async (_req, res, _next) => {
	res.writeHead(200);
	res.end('OK');
};

app.get('/health', checkConnections);
app.get('/startup', checkConnections);

app.listen(PORT, () => {
	console.log(`[server]: Server is running at http://localhost:${PORT}`);
});

[
	'SIGINT',
	'SIGTERM',
	'SIGQUIT',
	'uncaughtException',
	'unhandledRejection',
].forEach((signal) => {
	process.on(signal, (e) => {
		console.log('Process forced shutdown:', signal, e);
		// shutdown PostHog client
		PostHogClient.shutdown()
			.then(() => {
				console.log('PostHog shut down successfully.');
				process.exit(0);
			})
			.catch((error) => {
				console.error('Error during PostHog shutdown:', error);
				process.exit(1);
			});
	});
});
