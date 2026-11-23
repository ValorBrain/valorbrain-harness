/**
 * Agent tools over REST. Each one answers with text the model can read; an
 * engine error becomes a short message, never an exception into the turn.
 */
import type { ValorBrainClient } from "./client.js";
export type ToolResult = {
    content: Array<{
        type: "text";
        text: string;
    }>;
    details: Record<string, unknown>;
};
export type AgentTool = {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(toolCallId: string, params: Record<string, unknown>): Promise<ToolResult>;
};
export declare const TOOL_NAMES: readonly ["valorbrain_search", "valorbrain_get", "valorbrain_store"];
export declare function createTools(client: ValorBrainClient): AgentTool[];
