// Swift Testing ABI v0 → TAP 14 formatter.
//
// The runner streams JSON records into `window.__wasm_tests.records`. Each
// record carries `{kind, version, payload}`. We only need a subset for TAP:
//
//   - payload.kind === "testStarted"    — register test id, init status=pass
//   - payload.kind === "issueRecorded"  — flip that test to fail, capture msg
//   - payload.kind === "testEnded"      — mark test as finished (stable order)
//   - payload.kind === "runEnded"       — sentinel, emit trailing summary
//
// Tests that start but never end are reported as "not ok … # never ended".

/**
 * @param {string[]} rawRecords  Array of JSON-string records.
 * @param {object} runnerState   `{ success: boolean, error: string|null }`
 *                               as surfaced by `window.__wasm_tests`.
 * @returns {{ tap: string, passed: number, failed: number, success: boolean }}
 */
export function formatTAP(rawRecords, runnerState) {
    const tests = new Map();
    const order = [];
    let unparsable = 0;

    for (const raw of rawRecords) {
        let rec;
        try { rec = JSON.parse(raw); }
        catch { unparsable += 1; continue; }
        if (!rec || rec.kind !== "event" || !rec.payload) continue;
        const p = rec.payload;
        const id = p.testID ?? null;
        if (!id) continue;

        if (p.kind === "testStarted") {
            if (!tests.has(id)) {
                tests.set(id, { id, passed: true, ended: false, messages: [] });
                order.push(id);
            }
            continue;
        }
        if (p.kind === "issueRecorded") {
            if (!tests.has(id)) {
                tests.set(id, { id, passed: false, ended: false, messages: [] });
                order.push(id);
            }
            const entry = tests.get(id);
            entry.passed = false;
            entry.messages.push(extractIssueMessage(p));
            continue;
        }
        if (p.kind === "testEnded") {
            if (!tests.has(id)) {
                tests.set(id, { id, passed: true, ended: true, messages: [] });
                order.push(id);
            } else {
                tests.get(id).ended = true;
            }
        }
    }

    const lines = [];
    lines.push("TAP version 14");

    const runnerFailed = runnerState && runnerState.error;
    if (runnerFailed) {
        lines.push(`Bail out! runner error: ${runnerState.error}`);
        return {
            tap: lines.join("\n") + "\n",
            passed: 0,
            failed: 0,
            success: false,
        };
    }

    const total = order.length;
    lines.push(`1..${total}`);

    let passed = 0;
    let failed = 0;
    order.forEach((id, i) => {
        const t = tests.get(id);
        const n = i + 1;
        const name = tapEscape(id);
        if (!t.ended) {
            failed += 1;
            lines.push(`not ok ${n} - ${name} # never ended`);
            lines.push(...yamlBlock({ severity: "fatal", messages: ["Test did not reach testEnded"] }));
            return;
        }
        if (t.passed) {
            passed += 1;
            lines.push(`ok ${n} - ${name}`);
        } else {
            failed += 1;
            lines.push(`not ok ${n} - ${name}`);
            lines.push(...yamlBlock({ severity: "fail", messages: t.messages }));
        }
    });

    if (unparsable > 0) {
        lines.push(`# ${unparsable} unparsable record(s)`);
    }
    if (runnerState && runnerState.success === false && failed === 0) {
        lines.push(`# runner reported success=false but no per-test failures were observed`);
        failed += 1;
    }
    lines.push(`# tests ${total}`);
    lines.push(`# pass ${passed}`);
    lines.push(`# fail ${failed}`);

    return {
        tap: lines.join("\n") + "\n",
        passed,
        failed,
        success: failed === 0 && (!runnerState || runnerState.success !== false),
    };
}

function extractIssueMessage(payload) {
    const issue = payload.issue ?? {};
    const sourceMsg = issue.sourceContext?.message;
    if (typeof sourceMsg === "string" && sourceMsg.length > 0) return sourceMsg;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const joined = messages
        .map((m) => (typeof m === "string" ? m : m?.text))
        .filter((s) => typeof s === "string" && s.length > 0)
        .join("; ");
    if (joined.length > 0) return joined;
    if (typeof issue.kind === "string") return issue.kind;
    return "issueRecorded";
}

function yamlBlock({ severity, messages }) {
    const body = messages.length === 0 ? ["(no message)"] : messages;
    const lines = ["  ---"];
    lines.push(`  severity: ${severity}`);
    lines.push(`  messages:`);
    for (const m of body) {
        lines.push(`    - ${yamlEscape(m)}`);
    }
    lines.push("  ...");
    return lines;
}

function yamlEscape(s) {
    const str = String(s);
    if (/^[\w .,:()\[\]\/=+-]+$/.test(str) && !str.includes(": ")) return str;
    return '"' + str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
}

function tapEscape(name) {
    return String(name).replace(/#/g, "\\#");
}
