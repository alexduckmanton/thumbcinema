// Vercel entry point. Every API path is rewritten here by vercel.json so the whole
// back end is one function — one cold start, and the same router the dev server uses.
import { handleApi } from '../lib/router.js';

export default function handler(req, res) {
	return handleApi(req, res);
}

export const config = {
	api: {
		// The router reads the raw stream itself (see lib/http.js).
		bodyParser: false
	}
};
