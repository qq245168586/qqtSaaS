// Read-only, company/user-isolated cache. Authentication credentials never enter IndexedDB.
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
let scope = '';
export function getCacheScope() {
  return scope;
}
interface CacheEntry {
  key: string;
  savedAt: number;
  value: unknown;
}
export function setCacheScope(companyId: string, userId: string, role = '') {
  scope = `${companyId}:${userId}:${role}:`;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tmy-tri-phase2-readonly', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('responses', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function cacheWrite(url: string, value: unknown, expectedScope = scope) {
  if (!scope || expectedScope !== scope) return;
  const key = scope + url;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('responses', 'readwrite');
      tx.objectStore('responses').put({ key, savedAt: Date.now(), value } satisfies CacheEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function cacheRead(url: string, expectedScope = scope): Promise<unknown> {
  if (!scope || expectedScope !== scope) return undefined;
  const key = scope + url;
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('responses').objectStore('responses').get(key);
      request.onsuccess = () => {
        const entry = request.result as CacheEntry | undefined;
        resolve(entry && Date.now() - entry.savedAt <= MAX_AGE ? entry.value : undefined);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function clearCache() {
  const previous = scope ? scope.split(':').slice(0, 2).join(':') + ':' : '';
  scope = '';
  if (!previous) return;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('responses', 'readwrite');
      const store = tx.objectStore('responses');
      const cursor = store.openCursor(IDBKeyRange.bound(previous, previous + '\uffff'));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (item) {
          item.delete();
          item.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const cacheable = (url: string) =>
  /^\/(tasks|delivery-notes|departments|employees|categories|customers|customer-categories|products|personnel|print-templates)(\/\d+)?(\?|$)/.test(
    url,
  ) &&
  !url.includes('/images') &&
  !url.includes('/export');
