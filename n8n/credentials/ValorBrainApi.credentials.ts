import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import { DEFAULT_API_URL, USER_AGENT } from '../nodes/ValorBrain/GenericFunctions';

export class ValorBrainApi implements ICredentialType {
	name = 'valorBrainApi';

	displayName = 'ValorBrain API';

	icon: Icon = { light: 'file:valorBrain.svg', dark: 'file:valorBrain.dark.svg' };

	documentationUrl = 'https://github.com/ValorBrain/valorbrain-harness/tree/main/n8n#credential';

	properties: INodeProperties[] = [
		{
			displayName: 'Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'A ValorBrain token. It starts with vbm_. Create one in the ValorBrain app (Settings > MCP tokens) or with npx @valorbrain/cli init --agent. The token chooses the tenant.',
		},
		{
			displayName: 'API URL',
			name: 'apiUrl',
			type: 'string',
			default: DEFAULT_API_URL,
			description:
				'The address of the ValorBrain REST API. Change it only for a self-hosted or a staging engine.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.token}}',
			},
		},
	};

	// Listing documents by a pattern that matches nothing reads no content and writes nothing. It
	// answers 401 for a bad token.
	test: ICredentialTestRequest = {
		request: {
			baseURL: `={{($credentials.apiUrl || "${DEFAULT_API_URL}").replace(/\\/+$/, "")}}`,
			url: '/documents',
			method: 'GET',
			qs: { pattern: 'n8n-credential-test' },
			headers: { 'User-Agent': USER_AGENT },
		},
	};
}
