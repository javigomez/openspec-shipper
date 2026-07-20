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
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Providers", link: "/providers/" },
      { text: "Reference", link: "/reference/cli" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Delivery flow", link: "/guide/delivery-flow" },
          { text: "Queue", link: "/guide/queue" },
        ],
      },
      {
        text: "Providers",
        items: [{ text: "OpenCode, Codex, and Claude", link: "/providers/" }],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "Configuration", link: "/reference/configuration" },
        ],
      },
      {
        text: "Troubleshooting",
        items: [{ text: "Blocked tasks", link: "/troubleshooting/blocked-tasks" }],
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
