import { rows, Row, db } from './db';
import type { EntityManager } from 'typeorm';
import type { User } from './auth';
import { companyFilter, companyColumns } from './company-scope';
export async function taskDeliveryLinks(
  taskIds: string[],
  u: User,
  m: EntityManager = db.manager,
): Promise<Map<string, Row[]>> {
  const map = new Map<string, Row[]>();
  if (!taskIds.length) return map;
  const scope = companyFilter(u, 'dn.company_id');
  const linked = await rows(
    `SELECT dn.id,dn.source_task_id,dn.note_number,dn.delivery_date,dn.is_draft,${companyColumns('dn')} FROM delivery_notes dn WHERE dn.source_task_id IN (${taskIds.map(() => '?').join(',')}) AND ${scope.sql} AND dn.deleted_at IS NULL ORDER BY dn.delivery_date DESC,dn.id DESC`,
    [...taskIds, ...scope.params],
    m,
  );
  for (const item of linked) {
    const key = String(item.source_task_id);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}
export async function withTaskLinks(tasks: Row[], u: User): Promise<Row[]> {
  const links = await taskDeliveryLinks(
    tasks.map((task) => String(task.id)),
    u,
  );
  return tasks.map((task) => ({
    ...task,
    delivery_note_count: links.get(String(task.id))?.length ?? 0,
    delivery_notes: links.get(String(task.id)) ?? [],
  }));
}
export async function withSourceTasks(notes: Row[], u: User): Promise<Row[]> {
  const ids = [
    ...new Set(notes.flatMap((note) => (note.source_task_id ? [String(note.source_task_id)] : []))),
  ];
  if (!ids.length) return notes.map((note) => ({ ...note, source_task: null }));
  const scope = companyFilter(u, 't.company_id');
  const tasks = await rows(
    `SELECT t.id,t.title,t.status,t.deleted_at,${companyColumns('t')} FROM tasks t WHERE t.id IN (${ids.map(() => '?').join(',')}) AND ${scope.sql}`,
    [...ids, ...scope.params],
  );
  const mapping = new Map(tasks.map((task) => [String(task.id), task]));
  return notes.map((note) => ({
    ...note,
    source_task: mapping.has(String(note.source_task_id))
      ? {
          ...mapping.get(String(note.source_task_id)),
          deleted: Boolean(mapping.get(String(note.source_task_id))?.deleted_at),
        }
      : null,
  }));
}
