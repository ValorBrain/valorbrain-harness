// Test-only plugin: appends every hook payload OpenClaw delivers to a JSONL
// file (plugins.entries.vb-event-probe.config.out). Used by run-isolated.sh to
// capture real event shapes for test/fixtures.
import { appendFileSync } from "node:fs";

const HOOKS = [
  "session_start", "session_end", "before_prompt_build", "agent_end",
  "before_compaction", "after_compaction", "before_reset",
];

export default {
  id: "vb-event-probe",
  name: "Event probe",
  register(api) {
    const out = api.pluginConfig?.out;
    if (!out) return;
    for (const hook of HOOKS) {
      api.on(hook, (event, ctx) => {
        try {
          appendFileSync(out, `${JSON.stringify({ hook, event, ctx })}\n`);
        } catch {}
      }, { priority: 1 });
    }
  },
};
