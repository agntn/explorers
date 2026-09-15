import type { ContentNavigationItem } from "@nuxt/content";
import { PROVIDERS } from "../utils/providers";

const NAV_ICONS: Record<string, string> = {
  "/guide": "i-solar-book-2-linear",
  "/guide/cli": "i-solar-code-square-linear",
  "/guide/selection": "i-solar-routing-2-linear",
  "/guide/balances": "i-solar-wallet-linear",
  "/guide/transactions": "i-solar-bill-list-linear",
  "/guide/tokens": "i-solar-square-transfer-horizontal-linear",
  "/guide/contracts": "i-solar-code-file-linear",
  "/guide/gas-and-blocks": "i-solar-gas-station-linear",
  "/guide/errors": "i-solar-danger-triangle-linear",
  "/guide/agents": "i-solar-bot-linear",
  "/guide/custom": "i-solar-add-circle-linear",
  "/guide/explorer": "i-solar-tuning-2-linear",
  "/providers": "i-solar-library-linear",
  "/chains": "i-solar-layers-linear",
  "/explorer": "i-solar-tuning-2-linear",
  ...Object.fromEntries(PROVIDERS.map((provider) => [provider.to, provider.icon])),
};

export function getFirstPagePath(item: ContentNavigationItem): string {
  let current = item;
  while (current.children?.length) {
    current = current.children[0]!;
  }
  return current.path;
}

function withIcons(items: ContentNavigationItem[]): ContentNavigationItem[] {
  return items.map((item) => ({
    ...item,
    icon: NAV_ICONS[item.path] ?? item.icon,
    /** Leaf pages match exactly, so /guide isn't highlighted together with /guide/cli. */
    exact: !item.children?.length,
    children: item.children ? withIcons(item.children) : item.children,
  }));
}

export function useSubNavigation(
  providedNavigation?: Ref<ContentNavigationItem[] | null | undefined>,
) {
  const route = useRoute();
  const appConfig = useAppConfig();
  const navigation = providedNavigation ?? inject<Ref<ContentNavigationItem[]>>("navigation");

  const isDocsPage = computed(() => route.meta.layout === "docs");

  const subNavigationMode = computed(() => {
    if (!isDocsPage.value) return undefined;
    return (appConfig.navigation as { sub?: "header" | "aside" } | undefined)?.sub;
  });

  const currentSection = computed(() => {
    if (!subNavigationMode.value || !navigation?.value) return undefined;
    return navigation.value.find(
      (item) => route.path === item.path || route.path.startsWith(`${item.path}/`),
    );
  });

  const sections = computed(() => {
    if (!subNavigationMode.value || !navigation?.value) return [];
    return navigation.value
      .filter((item) => item.children?.length)
      .map((item) => ({
        label: item.title,
        icon: (NAV_ICONS[item.path] ?? item.icon) as string | undefined,
        to: getFirstPagePath(item),
        active: route.path === item.path || route.path.startsWith(`${item.path}/`),
      }));
  });

  const sidebarNavigation = computed(() => {
    const items =
      subNavigationMode.value && currentSection.value
        ? currentSection.value.children || []
        : navigation?.value || [];
    return withIcons(items);
  });

  return {
    subNavigationMode,
    sections,
    currentSection,
    sidebarNavigation,
  };
}
