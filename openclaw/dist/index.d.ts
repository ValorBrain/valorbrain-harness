/**
 * ValorBrain memory for OpenClaw — HTTP-only `kind: "memory"` plugin.
 *
 * Talks to a ValorBrain engine over REST (hosted by default, or a
 * self-hosted engine via `apiUrl`); needs no local binary. See README.md for
 * what leaves the machine and when.
 */
import { type Logger } from "./hooks.js";
/** The slice of OpenClaw's `OpenClawPluginApi` (2026.4.x) this plugin uses. */
export type PluginApi = {
    registrationMode?: "full" | "setup-only" | "setup-runtime" | "cli-metadata";
    config?: unknown;
    pluginConfig?: Record<string, unknown>;
    logger: Logger;
    on(hook: string, handler: (...args: never[]) => unknown, opts?: {
        priority?: number;
    }): void;
    registerTool(tool: unknown, opts?: {
        name?: string;
    }): void;
    registerService?(service: {
        id: string;
        start: () => void;
        stop?: () => Promise<void>;
    }): void;
    registerMemoryCapability?(capability: Record<string, unknown>): void;
};
/** System-prompt section (cached by providers): how to use the memory this plugin brings. */
export declare function memoryPromptSection(availableTools: Set<string>): string[];
declare const plugin: {
    id: string;
    name: string;
    description: string;
    version: string;
    kind: "memory";
    register(api: PluginApi): void;
};
export default plugin;
