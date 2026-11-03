// A backgrounded or forgotten connection must not publish a late response.
// This guard owns no credentials and deliberately does not retry requests.
export function createConnectionLifecycle() {
  let generation = 0;
  let active = null;
  return {
    begin() {
      generation++;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const current = generation;
      return {
        signal: controller.signal,
        abort: () => controller.abort(),
        isCurrent: () => generation === current,
        finish: () => { if (generation === current) active = null; },
      };
    },
    invalidate() {
      generation++;
      active?.abort();
      active = null;
    },
  };
}
