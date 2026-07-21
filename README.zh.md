**语言：** [English](https://github.com/javigomez/openspec-shipper/blob/main/README.md) | [Español](https://github.com/javigomez/openspec-shipper/blob/main/README.es.md) | [Català](https://github.com/javigomez/openspec-shipper/blob/main/README.ca.md) | 简体中文

# openspec-shipper

**自动交付 OpenSpec 变更。** 你负责编写规格，`openspec-shipper` 负责将变更加入队列、交给 AI 编码代理实现、创建 PR，并在合并后完成归档。

![openspec-shipper 演示](https://raw.githubusercontent.com/javigomez/openspec-shipper/main/docs/images/openspec-shipper-teaser.gif)

免费、开源，并采用 MIT 许可证。欢迎 fork、修改和提交 PR。

## 它能做什么

你已经在用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 编写变更提案和任务，后续流程可以交给 `openspec-shipper`：

1. 将变更添加到交付队列。
2. Shipper 创建一个隔离的 worktree，并将变更交给你选择的 AI 执行器：[OpenCode](https://opencode.ai)、[Codex CLI](https://github.com/openai/codex) 或 [Claude Code](https://claude.com/product/claude-code)。
3. 代理完成实现后，Shipper 推送分支并通过 `gh` 创建 PR。
4. 你负责审核并合并。
5. Shipper 在 OpenSpec 中归档变更并清理 worktree，无需手动整理分支。
6. 继续处理队列中的下一项。

你的主工作区不会被修改。所有操作都在独立的 worktree 中进行，因此 Shipper 在交付当前变更时，你仍然可以继续规划下一个变更。

## 使用 Codex 和 GPT-5.6 构建

我将 [Codex](https://github.com/openai/codex) 作为主动参与工程工作的伙伴，用它构建了 `openspec-shipper`。GPT-5.6 帮助我思考架构、质疑设计决策、调查故障、审查边界情况，并把一个个人工作流问题变成其他开发者也能使用的工具。

Codex 帮助我把这些决策落地为 TypeScript 代码、测试、执行器集成、npm 打包、文档和演示仓库。它参与了完整的软件开发生命周期：规划、实现、调试、测试、重构和发布准备。

Codex 也是产品本身的核心组成部分。Shipper 可以把队列中的每个 OpenSpec 变更交给隔离 worktree 中的 Codex CLI，同时由 runner 负责 Git 和 GitHub 的机械化步骤。这个项目用 Codex 构建，现在也帮助其他开发者更高效地使用 Codex：把 token 用在真正有价值的实现工作上，而不是重复的流程协调上。

## 一分钟看效果

查看 **[clean-repo-for-openspec-shipper-demo](https://github.com/javigomez/clean-repo-for-openspec-shipper-demo)**：这是一个预置了待交付 OpenSpec 变更的小型仓库。克隆仓库并按照 README 操作，大约一分钟即可看到完整的端到端流程。

## 亲自试试

```bash
npm install -D openspec-shipper
npx openspec-shipper init
npx openspec-shipper doctor
```

`init` 会引导你选择 AI 执行器（OpenCode、Codex CLI 或 Claude Code）和包管理器，然后安装队列运行所需的文件。`doctor` 会检查 `git`、`gh` 和所选执行器是否已经就绪。

当 OpenSpec 变更准备好交付后：

```bash
npx openspec-shipper queue add <你的变更名称>
npx openspec-shipper queue run
```

就是这么简单。Shipper 会负责从入队到合并的整个流程。

## 环境要求

- `git`
- 已完成身份验证的 [`gh`](https://cli.github.com/)（GitHub CLI）
- 以下任一工具：OpenCode、Codex CLI 或 Claude Code 订阅

## 参与贡献

我是 Javi Gómez，一名热爱 OpenSpec 的独立开发者。我创建这个工具，是为了摆脱价值不高的重复工作，把精力集中在定义变更和编写规格上。我决定把它分享出来，希望它也能为你节省大量时间。

欢迎提交 issue 和 PR，也欢迎 fork。这是一个仍处于早期阶段的项目，路线图完全开放。如果你基于它构建了新功能，或者将它调整得更适合自己的工作流，我很期待听到你的反馈。

## 完整文档

命令参考、配置选项、队列内部机制、执行器配置以及其他内容都可以在文档站点中找到：

**https://javigomez.github.io/openspec-shipper/**
