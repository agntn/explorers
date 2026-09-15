import { LANDING_SAMPLES, type ExplorerSample } from "../utils/landing-fixtures";

interface BalanceAnswer {
  provider: string;
  chain: string;
  balance: ExplorerSample["balance"];
}

interface HistoryAnswer {
  provider: string;
  address: string;
  items: ExplorerSample["history"];
}

interface GasAnswer {
  provider: string;
  gas: NonNullable<ExplorerSample["gas"]>;
}

function sampleKey(sample: ExplorerSample): string {
  return `${sample.chain}:${sample.input}`;
}

/** One clock for every landing panel; each recorded sample is swapped for the worker's answer once. */
export function useLandingExplorer() {
  const samples = ref<ExplorerSample[]>([...LANDING_SAMPLES]);
  const tick = ref(0);
  const paused = ref(false);
  const current = computed(() => samples.value[tick.value % samples.value.length]!);

  const refreshed = new Set<string>();
  let timer: number | undefined;

  async function refresh(sample: ExplorerSample) {
    const key = sampleKey(sample);
    if (refreshed.has(key)) {
      return;
    }
    refreshed.add(key);
    const query = { address: sample.input, chain: sample.chain, provider: sample.provider };
    const settled = await Promise.allSettled([
      $fetch<BalanceAnswer>("/api/balance", { query, retry: 0 }),
      $fetch<HistoryAnswer>("/api/tx", { query: { ...query, limit: 5 }, retry: 0 }),
      sample.gas
        ? $fetch<GasAnswer>("/api/gas", {
            query: { chain: sample.chain, provider: sample.provider },
            retry: 0,
          })
        : Promise.reject(new Error("no gas on this chain")),
    ]);
    const [balance, history, gas] = settled;
    const at = samples.value.findIndex((row) => sampleKey(row) === key);
    if (at === -1 || settled.every((row) => row.status === "rejected")) {
      return;
    }
    const base = samples.value[at]!;
    samples.value[at] = {
      ...base,
      ...(balance.status === "fulfilled" ? { balance: balance.value.balance } : {}),
      ...(history.status === "fulfilled"
        ? { history: history.value.items, address: history.value.address }
        : {}),
      ...(gas.status === "fulfilled" ? { gas: gas.value.gas } : {}),
      live: true,
    };
  }

  function step(delta: number) {
    tick.value = Math.max(0, tick.value + delta);
    void refresh(current.value);
  }

  function stopWalk() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }

  function startWalk() {
    stopWalk();
    if (!import.meta.client || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    timer = window.setInterval(() => {
      if (!paused.value && !document.hidden) {
        step(1);
      }
    }, 4800);
  }

  onMounted(() => {
    void refresh(current.value);
    startWalk();
  });

  onUnmounted(stopWalk);

  return { samples, tick, paused, current, step };
}
