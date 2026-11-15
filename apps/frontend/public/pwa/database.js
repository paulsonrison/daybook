export const databaseName = 'daybook-field-v1';
export async function update(work) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const request = store.get('current');
      let result, failure;
      request.onsuccess = () => {
        try {
          const previous = request.result ?? {
            scope: null,
            snapshot: null,
            queue: [],
            receipts: [],
          };
          result = work(previous);
          if (result === null) store.delete('current');
          else store.put(result, 'current');
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          failure ?? tx.error ?? new Error('Device storage is unavailable.'),
        );
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const read = () => update((state) => state);
export const clear = () => update(() => null);
