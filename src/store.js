// Загруженные посетителем картинки хранятся в IndexedDB этого браузера,
// чтобы переживать перезагрузку страницы. Никуда не отправляются.
// Если хранилище недоступно (приватный режим и т. п.), всё просто работает без памяти.

const DB = 'neskuchno';
const OS = 'files';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(OS);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(OS, mode);
    const req = fn(t.objectStore(OS));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  });
}

export const store = {
  get: (k) => tx('readonly', (s) => s.get(k)).catch(() => null),
  put: (k, v) => tx('readwrite', (s) => s.put(v, k)).catch(() => {}),
  del: (k) => tx('readwrite', (s) => s.delete(k)).catch(() => {}),
};
