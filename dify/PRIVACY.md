# Privacy policy: ValorBrain plugin for Dify

This policy describes the data that the ValorBrain plugin for Dify sends and where it goes. The
plugin is published by Valor Digital (https://valor.digital), the maker of ValorBrain.

## Summary

- The plugin sends the inputs of its tools to the ValorBrain REST API, and nothing else.
- ValorBrain stores what **Store memory** sends, so that later searches and contexts can use it.
- The plugin itself stores no data, keeps no logs of tool inputs or outputs, and has no analytics
  or telemetry.

## What the plugin sends

The plugin sends data only when a Dify app runs one of its tools, or when you save the plugin
credentials. It never runs in the background.

| When | Request | Data sent to ValorBrain |
| --- | --- | --- |
| You save the credentials | `GET /api/v1/memory/health` | Your token, in the `Authorization` header. Nothing is written. |
| Store memory runs | `POST /api/v1/memory/store` | Title, content, type, tags (plus the tag `dify`), confidence and collection. |
| Prepare context runs | `POST /api/v1/memory/prepare` | The message, the collection, the recall budget and the fast-mode flag. |
| Search memory runs | `POST /search` | The query, the collection, the limit and the mode. |
| Forget memory runs | `GET /documents/{id}` (only with a collection scope), then `POST /documents/{id}/forget` | The document ID. |

Every request carries the token and the header `User-Agent: valorbrain-dify/<version>`. The
token decides the ValorBrain tenant; the plugin never sends a tenant ID.

When the app builder sets **Scope** to **Dify end user**, the collection name contains the ID
that Dify gives to the person who runs the app (for example `dify-user-<id>`). The plugin sends
no other Dify user data.

By default **Store memory** replaces obvious secrets (ValorBrain, OpenAI, Anthropic, GitHub,
GitLab, Slack and AWS key shapes, `Bearer` values, JWTs, `NAME_KEY=value` assignments and private
key blocks) with `[redacted]` before sending. This is a safety net, not a guarantee. The builder
can turn it off in the tool settings.

### Personal data

The plugin does not collect personal data on its own. But a memory, a message or a query can
contain personal data, for example a name, an email address or what a person said in a
conversation. That depends on what your Dify app sends. If your app sends personal data, you are
responsible for a legal basis to process it and for telling your users.

## Where the data goes

All data goes to one destination: the ValorBrain REST API at
`https://valorbrain-api.valor.digital`, or at the API URL that a workspace admin set in the plugin
credentials when the company runs its own ValorBrain engine. The plugin calls no other service and
does not follow redirects.

Valor Digital processes the data of the hosted service under its privacy policy:
https://valor.digital/privacidade/

To remove a memory, use the **Forget memory** tool or `POST /documents/{id}/forget`. For other
requests about your data, write to comercial@valor.digital.

## What Dify keeps

Dify stores the plugin credentials (token and API URL) in your Dify workspace, and it can keep
tool inputs and outputs in its own run logs. The Dify privacy policy and your Dify deployment
settings apply to that data.

## Contact

comercial@valor.digital
