import type { ContentNavigationItem } from "@nuxt/content";
import { PROVIDERS } from "../utils/providers";

const NAV_ICONS: Record<string, string> = {
  "/guide": "i-lucide-book-open",
  "/guide/cli": "i-lucide-terminal",
  "/guide/selection": "i-lucide-route",
  "/guide/balances": "i-lucide-wallet",
  "/guide/transactions": "i-lucide-list",
  "/guide/tokens": "i-lucide-arrow-left-right",
  "/guide/contracts": "i-lucide-file-code",
  "/guide/gas-and-blocks": "i-lucide-fuel",
  "/guide/errors": "i-lucide-triangle-alert",
  "/guide/agents": "i-lucide-bot",
  "/guide/custom": "i-lucide-plus",
  "/guide/explorer": "i-lucide-sliders-horizontal",
  "/providers": "i-lucide-library",
  "/chains": "i-lucide-layers",
  "/explorer": "i-lucide-sliders-horizontal",
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
