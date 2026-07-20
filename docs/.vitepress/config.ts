import { defineConfig } from "vitepress";

export default defineConfig({
  title: "OpenSpec Shipper",
  description: "Deliver OpenSpec changes through a reconciled, agent-backed queue.",
  base: "/openspec-shipper/",
  cleanUrls: true,
  lastUpdated: true,
  head: [["meta", { name: "theme-color", content: "#0f766e" }]],
  themeConfig: {
    nav: [
      { text: "Learn", link: "/guide/quick-start" },
      { text: "Providers", link: "/providers/" },
      { text: "Reference", link: "/reference/cli" },
    ],
    sidebar: [
      {
        text: "Learn",
        items: [
          { text: "1. Quick start", link: "/guide/quick-start" },
          { text: "2. Master the queue", link: "/guide/queue" },
          { text: "3. Plan changes while Shipper ships", link: "/guide/plan-changes" },
          { text: "4. When the queue blocks", link: "/guide/blocked-queue" },
          { text: "5. Pick the right model", link: "/guide/choosing-models" },
          { text: "6. Ship like a team of two", link: "/guide/ship-like-a-team" },
        ],
      },
      {
        text: "Providers",
        items: [{ text: "OpenCode, Codex, and Claude", link: "/providers/" }],
      },
      {
        text: "Reference",
        items: [
          { text: "Delivery flow", link: "/reference/delivery-flow" },
          { text: "CLI", link: "/reference/cli" },
          { text: "Configuration", link: "/reference/configuration" },
        ],
      },
    ],
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/javigomez/openspec-shipper" }],
    editLink: {
      pattern: "https://github.com/javigomez/openspec-shipper/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright OpenSpec Shipper contributors",
    },
  },
});
