import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
const pendingSchema = z.object({
  attempt_id: z.string().uuid(),
  from_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  target_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  requested_at: z.string().datetime(),
});
const resultSchema = z.object({
  attempt_id: z.string().uuid(),
  phase: z.enum([
    'helper_ready',
    'waiting_for_exit',
    'installer_started',
    'installer_finished',
    'failed',
  ]),
  exit_code: z.number().int().nullable(),
  reason: z
    .enum(['installer_missing', 'app_exit_timeout', 'launch_error', 'installer_exit'])
    .optional(),
});
export function beginUpdateReceipt(directory: string, from: string, target: string) {
  const pending = pendingSchema.parse({
    attempt_id: randomUUID(),
    from_version: from,
    target_version: target,
    requested_at: new Date().toISOString(),
  });
  writeFileSync(path.join(directory, 'update-pending.json'), JSON.stringify(pending), {
    mode: 0o600,
  });
  return {
    attempt_id: pending.attempt_id,
    file: path.join(directory, 'update-helper-result.json'),
  };
}
export function readUpdateReceipt(directory: string, currentVersion: string) {
  let pending: z.infer<typeof pendingSchema>;
  try {
    pending = pendingSchema.parse(
      JSON.parse(readFileSync(path.join(directory, 'update-pending.json'), 'utf8')),
    );
  } catch {
    return null;
  }
  let result: z.infer<typeof resultSchema> | undefined;
  try {
    const parsed = resultSchema.parse(
      JSON.parse(
        readFileSync(path.join(directory, 'update-helper-result.json'), 'utf8').replace(
          /^\uFEFF/,
          '',
        ),
      ),
    );
    if (parsed.attempt_id === pending.attempt_id) result = parsed;
  } catch {
    /* Helper may still be writing its result. */
  }
  const current = currentVersion.split('.').map(Number),
    target = pending.target_version.split('.').map(Number);
  const success =
    current.every(Number.isFinite) &&
    (current[0] > target[0] ||
      (current[0] === target[0] &&
        (current[1] > target[1] || (current[1] === target[1] && current[2] >= target[2]))));
  return {
    success,
    target_version: pending.target_version,
    phase: result?.phase ?? ('unknown' as const),
    exit_code: result?.exit_code ?? undefined,
    reason: result?.reason,
  };
}
export function clearUpdateReceipt(directory: string) {
  for (const name of ['update-pending.json', 'update-helper-result.json'])
    try {
      unlinkSync(path.join(directory, name));
    } catch {
      /* Already cleared. */
    }
}
