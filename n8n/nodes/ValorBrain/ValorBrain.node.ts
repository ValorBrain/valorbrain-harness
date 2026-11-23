import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { jsonParse, NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { checkTime, CREDENTIAL, splitList, valorBrainApiRequest } from './GenericFunctions';

const show = (operation: string) => ({ show: { resource: ['memory'], operation: [operation] } });
const showStore = show('store');
const showWrite = show('writeDocument');
const showPrepare = show('prepare');
const showSearch = show('search');
const showForget = show('forget');

const resource: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [{ name: 'Memory', value: 'memory' }],
	default: 'memory',
};

const operation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['memory'] } },
	options: [
		{
			name: 'Forget',
			value: 'forget',
			description: 'Deactivate one document by its ID. It stops showing in search and context.',
			action: 'Forget a document',
		},
		{
			name: 'Prepare Context',
			value: 'prepare',
			description: 'Get the memory relevant to a message, as Markdown ready for a prompt',
			action: 'Prepare context for a message',
		},
		{
			name: 'Search',
			value: 'search',
			description: 'Hybrid search over the documents of the tenant',
			action: 'Search memory',
		},
		{
			name: 'Store Memory',
			value: 'store',
			description: 'Store a typed memory: a decision, an observation, a lesson or a note',
			action: 'Store a memory',
		},
		{
			name: 'Write Document',
			value: 'writeDocument',
			description: 'Create or update a document by its path, with the time the fact happened',
			action: 'Write a document',
		},
	],
	default: 'store',
};

const storeFields: INodeProperties[] = [
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Acme pilot budget moved to 40k',
		description: 'A short title, at least 5 characters',
		displayOptions: showStore,
	},
	{
		displayName: 'Content',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		placeholder: 'e.g. Nadia confirmed by email that the budget for the Acme pilot is now 40k.',
		description: 'The text to keep, at least 20 characters. Send the original text, not a summary.',
		displayOptions: showStore,
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showStore,
		options: [
			{
				displayName: 'Collection',
				name: 'collection',
				type: 'string',
				default: '',
				description: 'The collection to store into. Without it, the collection of the token.',
			},
			{
				displayName: 'Confidence',
				name: 'confidence',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
				default: 0.8,
				description: 'How sure the source is, from 0 to 1',
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				placeholder: 'e.g. acme, budget',
				description: 'Tags separated by commas',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: 'note',
				options: [
					{ name: 'Decision', value: 'decision' },
					{ name: 'Handoff', value: 'handoff' },
					{ name: 'Lesson', value: 'lesson' },
					{ name: 'Milestone', value: 'milestone' },
					{ name: 'Note', value: 'note' },
					{ name: 'Observation', value: 'observation' },
					{ name: 'Problem', value: 'problem' },
				],
				description: 'The kind of memory',
			},
		],
	},
];

const writeFields: INodeProperties[] = [
	{
		displayName: 'Collection',
		name: 'collection',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. support-tickets',
		description: 'The collection of the document',
		displayOptions: showWrite,
	},
	{
		displayName: 'Path',
		name: 'path',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. tickets/4821.md',
		description:
			'The unique path of the document in the collection. A second write to the same path updates the document.',
		displayOptions: showWrite,
	},
	{
		displayName: 'Content',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'The body of the document, up to 1 MB',
		displayOptions: showWrite,
	},
	{
		displayName: 'Occurred At',
		name: 'eventAt',
		type: 'string',
		default: '',
		placeholder: 'e.g. 2026-07-28T16:00:00Z',
		description:
			'When the fact in the document happened, in ISO 8601 with a zone. Search can order by it. Without it, the document has no event time.',
		displayOptions: showWrite,
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: showWrite,
		options: [
			{
				displayName: 'Content Type',
				name: 'contentType',
				type: 'string',
				default: 'note',
				description: 'The kind of document, for example note, ticket or transcript',
			},
			{
				displayName: 'Event Type',
				name: 'eventType',
				type: 'string',
				default: '',
				placeholder: 'e.g. email',
				description: 'What kind of event the document records',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'json',
				default: '{}',
				description: 'Your own JSON, kept with the document',
			},
			{
				displayName: 'Run ID',
				name: 'runId',
				type: 'string',
				default: '',
				description: 'The ID of the workflow run or agent run that wrote the document',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'The title of the document',
			},
			{
				displayName: 'User ID',
				name: 'userId',
				type: 'string',
				default: '',
				description:
					'The ValorBrain user the document belongs to. Set it from the trigger or the user record, never from a model.',
			},
		],
	},
];

const prepareFields: INodeProperties[] = [
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 2 },
		required: true,
		default: '',
		placeholder: 'e.g. What did we agree with Acme about the pilot?',
		description: 'The task or the question to prepare context for',
		displayOptions: showPrepare,
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showPrepare,
		options: [
			{
				displayName: 'Collection',
				name: 'collection',
				type: 'string',
				default: '',
				description: 'Read only this collection',
			},
			{
				displayName: 'Episode ID',
				name: 'episodeId',
				type: 'string',
				default: '',
				description: 'The conversation the message belongs to',
			},
			{
				displayName: 'Fast Mode',
				name: 'fastMode',
				type: 'boolean',
				default: false,
				description: 'Whether to skip the slower recall steps and answer sooner',
			},
			{
				displayName: 'Include Recall',
				name: 'includeRecall',
				type: 'boolean',
				default: true,
				description: 'Whether to add the memory relevant to the message, not only the briefing',
			},
			{
				displayName: 'Recall Budget',
				name: 'recallBudget',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 2000,
				description: 'The token budget of the recalled memory',
			},
		],
	},
];

const searchFields: INodeProperties[] = [
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Acme pilot budget',
		description: 'The question or the words to look for',
		displayOptions: showSearch,
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showSearch,
		options: [
			{
				displayName: 'Collection',
				name: 'collection',
				type: 'string',
				default: '',
				description: 'Search only these collections, separated by commas',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				default: 'auto',
				options: [
					{ name: 'Auto', value: 'auto' },
					{ name: 'Hybrid', value: 'hybrid' },
					{ name: 'Keyword', value: 'keyword' },
					{ name: 'Semantic', value: 'semantic' },
				],
				description: 'How to match the query',
			},
			{
				displayName: 'Order',
				name: 'order',
				type: 'options',
				default: 'relevance',
				options: [
					{ name: 'Relevance', value: 'relevance', description: 'Most relevant first' },
					{ name: 'Event Time', value: 'event_time', description: 'By the time the fact happened' },
				],
				description: 'The order of the results',
			},
			{
				displayName: 'Profile',
				name: 'profile',
				type: 'options',
				default: 'balanced',
				options: [
					{ name: 'Balanced', value: 'balanced' },
					{ name: 'Deep', value: 'deep' },
					{ name: 'Speed', value: 'speed' },
				],
				description: 'Trade speed for depth',
			},
		],
	},
];

const forgetFields: INodeProperties[] = [
	{
		displayName: 'Document ID',
		name: 'documentId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 59b69f',
		description:
			"The docid that 'Store Memory', 'Write Document' and 'Search' return. A leading # is removed.",
		displayOptions: showForget,
	},
];

export class ValorBrain implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ValorBrain',
		name: 'valorBrain',
		icon: { light: 'file:valorBrain.svg', dark: 'file:valorBrain.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'ValorBrain is durable memory for AI agents. Store, write, prepare context, search and forget.',
		defaults: {
			name: 'ValorBrain',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: CREDENTIAL,
				required: true,
			},
		],
		properties: [
			resource,
			operation,
			...storeFields,
			...writeFields,
			...prepareFields,
			...searchFields,
			...forgetFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resourceName = this.getNodeParameter('resource', i) as string;
				const operationName = this.getNodeParameter('operation', i) as string;
				const handler = resourceName === 'memory' ? operations[operationName] : undefined;
				if (!handler) {
					throw new NodeOperationError(
						this.getNode(),
						`The operation '${operationName}' is not known for '${resourceName}'`,
						{ itemIndex: i },
					);
				}
				const json = await handler.call(this, i);
				returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// An API refusal and a parameter error already carry their item; keep them as they are.
				const nodeError =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				throw nodeError;
			}
		}

		return [returnData];
	}
}

type Operation = (this: IExecuteFunctions, i: number) => Promise<IDataObject>;

/** Read a string parameter, trimmed. */
function text(this: IExecuteFunctions, name: string, i: number): string {
	const value = this.getNodeParameter(name, i, '');
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

/** Refuse a required text that is shorter than the API accepts. */
function requireText(
	this: IExecuteFunctions,
	value: string,
	displayName: string,
	min: number,
	i: number,
): void {
	if (value.length >= min) return;
	throw new NodeOperationError(
		this.getNode(),
		value === ''
			? `'${displayName}' is empty [item ${i}]`
			: `'${displayName}' needs at least ${min} characters [item ${i}]`,
		{ itemIndex: i },
	);
}

/** Copy the non-empty values of `fields` to `body`, under the API keys. */
function copyFields(body: IDataObject, fields: IDataObject, keys: Record<string, string>): void {
	for (const [field, apiKey] of Object.entries(keys)) {
		const raw = fields[field];
		const value = typeof raw === 'string' ? raw.trim() : raw;
		if (value !== undefined && value !== null && value !== '') body[apiKey] = value;
	}
}

const store: Operation = async function (this, i) {
	const title = text.call(this, 'title', i);
	const content = text.call(this, 'content', i);
	requireText.call(this, title, 'Title', 5, i);
	requireText.call(this, content, 'Content', 20, i);
	const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;

	const body: IDataObject = { title, content };
	copyFields(body, fields, { type: 'type', collection: 'collection', confidence: 'confidence' });
	const tags = splitList(fields.tags);
	if (tags.length > 0) body.tags = tags;

	return await valorBrainApiRequest.call(this, 'POST', '/api/v1/memory/store', {
		body,
		itemIndex: i,
	});
};

const writeDocument: Operation = async function (this, i) {
	const collection = text.call(this, 'collection', i);
	const path = text.call(this, 'path', i);
	const content = this.getNodeParameter('content', i, '') as string;
	requireText.call(this, collection, 'Collection', 1, i);
	requireText.call(this, path, 'Path', 1, i);
	requireText.call(this, String(content ?? '').trim(), 'Content', 1, i);
	const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;

	const body: IDataObject = { collection, path, content };
	const eventAt = checkTime.call(this, this.getNodeParameter('eventAt', i, ''), 'Occurred At', i);
	if (eventAt) body.event_at = eventAt;
	copyFields(body, fields, {
		title: 'title',
		contentType: 'content_type',
		eventType: 'event_type',
		userId: 'user_id',
		runId: 'run_id',
	});
	if (fields.metadata !== undefined && fields.metadata !== '' && fields.metadata !== '{}') {
		body.metadata =
			typeof fields.metadata === 'string'
				? jsonParse<IDataObject>(fields.metadata, {
						errorMessage: `'Metadata' is not valid JSON [item ${i}]`,
					})
				: fields.metadata;
	}

	return await valorBrainApiRequest.call(this, 'POST', '/documents', { body, itemIndex: i });
};

const prepare: Operation = async function (this, i) {
	const message = text.call(this, 'message', i);
	requireText.call(this, message, 'Message', 1, i);
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const body: IDataObject = { message };
	copyFields(body, options, {
		collection: 'collection',
		episodeId: 'episode_id',
		recallBudget: 'recall_budget',
		fastMode: 'fast_mode',
		includeRecall: 'include_recall',
	});

	return await valorBrainApiRequest.call(this, 'POST', '/api/v1/memory/prepare', {
		body,
		itemIndex: i,
	});
};

const search: Operation = async function (this, i) {
	const query = text.call(this, 'query', i);
	requireText.call(this, query, 'Query', 1, i);
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const body: IDataObject = { query };
	copyFields(body, options, {
		collection: 'collection',
		limit: 'limit',
		mode: 'mode',
		order: 'order',
		profile: 'profile',
	});

	return await valorBrainApiRequest.call(this, 'POST', '/search', { body, itemIndex: i });
};

const forget: Operation = async function (this, i) {
	const documentId = text.call(this, 'documentId', i).replace(/^#/, '');
	requireText.call(this, documentId, 'Document ID', 1, i);

	return await valorBrainApiRequest.call(
		this,
		'POST',
		`/documents/${encodeURIComponent(documentId)}/forget`,
		{ itemIndex: i },
	);
};

const operations: Record<string, Operation | undefined> = {
	store,
	writeDocument,
	prepare,
	search,
	forget,
};
