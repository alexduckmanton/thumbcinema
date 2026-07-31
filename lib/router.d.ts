// The back end is plain JavaScript, shared verbatim between the Vercel function and
// the dev server. This is the only part of it TypeScript ever sees.
import type { IncomingMessage, ServerResponse } from 'node:http'

export declare function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void>
