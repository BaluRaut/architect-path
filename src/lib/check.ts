let passed = 0;
let failed = 0;

/** Print a pass/fail line. Returns the condition so you can branch on it. */
export function check(name: string, ok: boolean, hint?: string): boolean {
  if (ok) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ ${name}${hint ? `\n    hint: ${hint}` : ""}`);
  }
  return ok;
}

/** Print a heading. */
export function section(title: string): void {
  console.log(`\n${title}\n${"─".repeat(Math.min(title.length, 64))}`);
}

/** Print a line that is information, not a graded check. */
export function info(line: string): void {
  console.log(`  · ${line}`);
}

/** Print a measurement. Numbers line up so you can compare runs. */
export function measure(label: string, value: string): void {
  console.log(`  ${label.padEnd(44)} ${value}`);
}

/** Summarise and set the exit code. Call once at the end of a module. */
export function finish(): void {
  console.log(`\n${passed} passed, ${failed} failed${failed === 0 ? " — module complete" : ""}`);
  if (failed > 0) process.exitCode = 1;
  passed = 0;
  failed = 0;
}
