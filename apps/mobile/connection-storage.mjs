// Serialize secure-store operations and invalidate pending saves immediately
// when a user changes the PC address or forgets a connection.
export function createConnectionStorage({ get, set, remove }) {
  let tail = Promise.resolve();
  let generation = 0;
  const enqueue = action => {
    const operation = tail.catch(() => {}).then(action);
    tail = operation;
    return operation;
  };
  return {
    load: () => enqueue(get),
    save(value) {
      const expected = generation;
      return enqueue(async () => {
        if (expected !== generation) return false;
        await set(value);
        if (expected !== generation) { await remove(); return false; }
        const stored = await get();
        if (expected !== generation) { await remove(); return false; }
        if (stored !== value) {
          // A resolved write alone is not evidence that the credential survived.
          await remove();
          throw new Error('Secure storage write could not be verified');
        }
        return true;
      });
    },
    clear() {
      generation++;
      return enqueue(remove);
    },
  };
}
