import type { ExecutorProvider, ExecutorProviderId } from "../../domain/provider/provider.js";
import { codexCliProvider } from "./codex-cli/provider.js";
import { opencodeProvider } from "./opencode/provider.js";

const providers: Record<ExecutorProviderId, ExecutorProvider> = {
  opencode: opencodeProvider,
  "codex-cli": codexCliProvider,
};

export function providerById(id: ExecutorProviderId): ExecutorProvider {
  return providers[id];
}

export function allProviders(): ExecutorProvider[] {
  return Object.values(providers);
}
