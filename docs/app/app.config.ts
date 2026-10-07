export default defineAppConfig({
  docus: {
    colorMode: "dark",
  },
  /** Landing JSON-LD: a free SoftwareApplication published by the agntn Organization, tied to GitHub and npm through sameAs. */
  seo: {
    title: "@agntn/explorers",
    description:
      "Nineteen block explorer APIs behind one TypeScript contract. Balances, transactions, unspent outputs, tokens, contracts, gas and blocks on 30 chains. Library, CLI, MCP server, Pi and OMP.",
    schema: {
      type: "SoftwareApplication",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Node.js",
      price: 0,
      sameAs: ["https://github.com/agntn/explorers", "https://www.npmjs.com/package/@agntn/explorers"],
      organization: {
        name: "agntn",
        url: "https://agntn.dev",
        logo: "https://agntn.dev/icon-512.png",
        sameAs: ["https://github.com/agntn", "https://www.npmjs.com/org/agntn"],
      },
    },
  },
  header: {
    title: "@agntn/explorers",
  },
  /** Sections as tabs under the header, so the sidebar holds one section as the lists grow. */
  navigation: {
    sub: "header",
  },
  github: {
    url: "https://github.com/agntn/explorers",
    branch: "main",
    rootDir: "docs",
  },
  /** Docus adds the repository link itself, a GitHub social next to it is the same icon twice. */
  socials: {
    npm: "https://www.npmjs.com/package/@agntn/explorers",
  },
  ui: {
    colors: {
      primary: "amber",
      neutral: "slate",
    },
    /**
     * Buttons in the instrument grammar, by variant, so a page writes <UButton> and gets the look
     * from app.css: primary solid and neutral outline are boxed actions with the glyph in its own
     * cell, neutral subtle the small control of an instrument (`square` for a step button), and
     * the site's own `chip` variant a chip, primary for the picked one. Docus renders its search
     * field as neutral soft and its own buttons as neutral ghost and link, so those stay default.
     */
    button: {
      slots: {
        base: "h-9 rounded-lg px-3.5 text-sm leading-none font-medium cursor-pointer transition-colors",
      },
      variants: {
        variant: {
          chip: "",
        },
      },
      compoundVariants: [
        {
          color: "primary",
          variant: "solid",
          class: "explorers-action explorers-action-primary ring-0",
        },
        {
          color: "neutral",
          variant: "outline",
          class: "explorers-action ring-0",
        },
        {
          color: "neutral",
          variant: "subtle",
          class: "explorers-control ring-0",
        },
        {
          color: "neutral",
          variant: "subtle",
          square: true,
          class: "explorers-control-square",
        },
        {
          color: "neutral",
          variant: "chip",
          class: "explorers-chip",
        },
        {
          color: "primary",
          variant: "chip",
          class: "explorers-chip explorers-chip-on",
        },
      ],
    },
    /** Status words as boxed mono capitals: neutral quiet, subtle bright, primary the accent, error red. */
    badge: {
      slots: {
        base: "explorers-badge",
      },
      compoundVariants: [
        { color: "neutral", variant: "subtle", class: "explorers-badge-bright ring-0" },
        { color: "neutral", variant: "outline", class: "ring-0" },
        { color: "primary", variant: "outline", class: "explorers-badge-accent ring-0" },
        { color: "error", variant: "outline", class: "explorers-badge-error ring-0" },
      ],
    },
    /** Tabs as mono capitals on a quiet rule, the active one over an accent segment. */
    tabs: {
      compoundVariants: [
        {
          variant: "link",
          class: {
            list: "explorers-tabs-list",
            trigger: "explorers-tabs-trigger",
            indicator: "explorers-tabs-indicator",
          },
        },
      ],
    },
    /** A field with variant none sits inside a readout row: the row is its frame, the value is mono. */
    input: {
      compoundVariants: [
        { variant: "none", class: { base: "explorers-field", leadingIcon: "explorers-field-icon" } },
      ],
    },
    selectMenu: {
      slots: {
        content: "explorers-menu rounded-none ring-0 shadow-none bg-transparent",
        group: "explorers-menu-group",
        item: "explorers-menu-item",
        itemLeadingIcon: "explorers-field-icon",
        input: "explorers-menu-input",
      },
      compoundVariants: [
        {
          variant: "none",
          class: {
            base: "explorers-field",
            leadingIcon: "explorers-field-icon",
            trailingIcon: "explorers-field-icon",
          },
        },
      ],
    },
    /** A failed read: a red edge and the message in mono, no box. */
    alert: {
      compoundVariants: [
        {
          color: "error",
          variant: "outline",
          class: {
            root: "explorers-alert ring-0",
            title: "explorers-alert-title",
            icon: "explorers-alert-icon",
          },
        },
      ],
    },
    /** A tooltip is a console label: flat, clipped corner, mono, and it wraps, because it carries full addresses. */
    tooltip: {
      slots: {
        content:
          "explorers-tooltip h-auto max-w-[min(32rem,calc(100vw-2rem))] rounded-none bg-transparent shadow-none ring-0 px-3 py-1.5 data-[state=delayed-open]:animate-none data-[state=closed]:animate-none",
        text: "whitespace-normal text-highlighted [overflow-wrap:anywhere]",
      },
    },
    /** The site header, the search field and the keys in the instrument grammar; the look lives in app.css. */
    header: {
      slots: {
        root: "explorers-site-header",
      },
    },
    contentSearchButton: {
      slots: {
        base: "explorers-search",
      },
    },
    /** The search modal and its palette in the instrument grammar; the look lives in app.css (portalled). */
    contentSearch: {
      slots: {
        modal: "explorers-search-modal",
      },
    },
    commandPalette: {
      slots: {
        root: "explorers-palette",
        input: "explorers-palette-input",
        close: "explorers-palette-close",
        group: "explorers-palette-group",
        label: "explorers-palette-label",
        item: "explorers-palette-item",
        itemLeadingIcon: "explorers-palette-icon",
        itemLabel: "explorers-palette-text",
        itemLabelBase: "explorers-palette-name",
        itemDescription: "explorers-palette-about",
        empty: "explorers-palette-empty",
      },
    },
    kbd: {
      base: "explorers-kbd",
    },
    pageHeader: {
      slots: {
        root: "explorers-page-header py-8 border-b-0",
        headline: "explorers-eyebrow mb-3",
        title: "text-3xl sm:text-4xl font-medium tracking-tight text-highlighted",
        description: "text-base leading-7 text-muted",
      },
    },
    /**
     * The layouts with a right aside get one track per panel instead of the ten column grid: the toc
     * takes a fixed 13.75rem, a little wider than Nuxt UI's, and the text keeps 52rem on a large
     * screen, the width the rosters need before they stack.
     */
    page: {
      compoundVariants: [
        {
          left: true,
          right: true,
          class: {
            root: "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_min(13.75rem,20%)]",
            left: "lg:col-span-1",
            center: "lg:col-span-1",
            right: "lg:col-span-1",
          },
        },
        {
          left: false,
          right: true,
          class: {
            root: "lg:grid-cols-[minmax(0,1fr)_min(13.75rem,20%)]",
            center: "lg:col-span-1",
            right: "lg:col-span-1",
          },
        },
      ],
    },
    /** Nuxt UI truncates TOC entries; headings here are sentences, so let them wrap. */
    contentToc: {
      slots: {
        linkText: "whitespace-normal",
      },
    },
    prose: {
      callout: {
        slots: {
          base: "rounded-xl px-4 py-3.5",
        },
      },
      card: {
        slots: {
          base: "rounded-xl explorers-frame border-0 p-5 bg-default hover:bg-muted",
          icon: "size-5 mb-3 text-muted transition-colors group-hover:text-primary",
          title: "text-sm font-medium",
          description: "text-sm text-muted",
        },
      },
      cardGroup: {
        base: "grid grid-cols-1 sm:grid-cols-2 gap-3 my-5 *:my-0",
      },
      /** Inline code in the instrument grammar; the look lives in `.explorers-code` in app.css. */
      code: {
        base: "explorers-code",
      },
      pre: {
        slots: {
          header: "border-default bg-default",
          base: "border-default bg-muted",
        },
      },
    },
    pageHero: {
      slots: {
        title: "font-medium tracking-tight",
        description: "text-base leading-7 sm:text-lg",
      },
    },
  },
});
