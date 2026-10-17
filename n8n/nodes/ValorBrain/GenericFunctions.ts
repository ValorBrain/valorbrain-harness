import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

/** Keep it equal to "version" in package.json. A test checks it. */
export const VERSION = '0.1.0';

export const CREDENTIAL = 'valorBrainApi';

export const DEFAULT_API_URL = 'https://valorbrain-api.valor.digital';

/** The User-Agent of every request, so that the server can tell this integration apart. */
export const USER_AGENT = `valorbrain-n8n/${VERSION}`;

/** An ISO 8601 time with a zone: Z or an offset. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

/** The API URL of the credential, with no slash at the end. */
async function apiUrl(this: IExecuteFunctions): Promise<string> {
	const credentials = await this.getCredentials(CREDENTIAL);
	const value =
		typeof credentials.apiUrl === 'string' && credentials.apiUrl.trim() !== ''
			? credentials.apiUrl
			: DEFAULT_API_URL;
	return value.trim().replace(/\/+$/, '');
}

/**
 * Send one request to the ValorBrain REST API with the ValorBrain API credential. The tenant comes
 * from the token, so the request never carries a tenant header. When the API refuses the request,
 * this throws a NodeApiError with the status, the message of the API and a hint.
 */
export async function valorBrainApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; itemIndex?: number } = {},
): Promise<IDataObject> {
	const request: IHttpRequestOptions = {
		method,
		url: `${await apiUrl.call(this)}${path}`,
		headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (options.body !== undefined) request.body = options.body;

	let response: IN8nHttpFullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL,
			request,
		)) as IN8nHttpFullResponse;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: options.itemIndex });
	}

	const status = response.statusCode;
	const data = (
		response.body && typeof response.body === 'object' ? response.body : {}
	) as IDataObject;
	if (status < 400) return data;

	throw new NodeApiError(this.getNode(), data as JsonObject, {
		itemIndex: options.itemIndex,
		httpCode: String(status),
		...refusal(status, data, response.headers ?? {}),
	});
}

/** The message and the description of a refusal of the API, in words for the person. */
export function refusal(
	status: number,
	data: IDataObject,
	headers: IDataObject,
): { message: string; description?: string } {
	const error = typeof data.error === 'string' ? data.error : undefined;
	const retryAfter = headers['retry-after'];

	const hints: string[] = [];
	if (status === 401) {
		hints.push("Check the 'Token' and the 'API URL' of the ValorBrain API credential.");
	}
	if (status === 403) hints.push('The token has no permission for this operation.');
	if (status === 404) hints.push('Check the ID. A document you cannot read answers as missing.');
	if (status === 429) {
		hints.push(
			retryAfter
				? `Too many requests. Try again after ${String(retryAfter)} seconds.`
				: 'Too many requests. Try again later, or turn on Retry On Fail in the node settings.',
		);
	}

	return {
		message: error
			? `ValorBrain refused the request: ${error}`
			: `ValorBrain answered with status ${status}`,
		description: hints.length > 0 ? hints.join(' ') : undefined,
	};
}

/**
 * Read a time parameter. An empty value gives undefined. A value with no zone is refused, because
 * the API reads each time with its zone.
 */
export function checkTime(
	this: IExecuteFunctions,
	value: unknown,
	displayName: string,
	itemIndex: number,
): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	let text: string;
	if (value instanceof Date) {
		text = value.toISOString();
	} else if (typeof value === 'object' && 'toISO' in value && typeof value.toISO === 'function') {
		// A Luxon DateTime, as $now gives.
		text = String(value.toISO());
	} else {
		text = String(value).trim();
	}
	if (!ISO_WITH_ZONE.test(text) || Number.isNaN(Date.parse(text))) {
		throw new NodeOperationError(
			this.getNode(),
			`'${displayName}' is not an ISO 8601 time with a zone [item ${itemIndex}]`,
			{
				itemIndex,
				description:
					'Write the time with a zone, for example 2026-07-28T16:00:00Z, or use the expression {{ $now.toISO() }}.',
			},
		);
	}
	return text;
}

/** Split a comma-separated list into trimmed, non-empty values. */
export function splitList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter((v) => v !== '');
	if (typeof value !== 'string') return [];
	return value
		.split(',')
		.map((v) => v.trim())
		.filter((v) => v !== '');
}
