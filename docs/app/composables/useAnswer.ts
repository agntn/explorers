import { errorText, errorStatus } from "../utils/wire";

/**
 * One worker call with its loading, error and answer state, and a `load(query)` that skips the
 * request when the same query already answered. Every panel that reads from `/api` is this.
 */
export function useAnswer<T>(url: string) {
  const loading = ref(false);
  const error = ref<string>();
  const status = ref<number | null>(null);
  const answer = ref<T>();
  let answered: string | undefined;

  async function load(query: Record<string, string | number | undefined>, force = false) {
    const key = JSON.stringify(query);
    if (!force && answer.value !== undefined && answered === key) return;
    loading.value = true;
    error.value = undefined;
    status.value = null;
    try {
      answer.value = await $fetch<T>(url, { query, retry: 0 });
      answered = key;
    } catch (caught) {
      /** A refresh that fails keeps the last answer on screen; a new query that fails shows only the error. */
      if (answered !== key) answer.value = undefined;
      answered = undefined;
      error.value = errorText(caught);
      status.value = errorStatus(caught);
    } finally {
      loading.value = false;
    }
  }

  function reset() {
    answer.value = undefined;
    answered = undefined;
    error.value = undefined;
    status.value = null;
  }

  return { loading, error, status, answer, load, reset };
}
