import type { ExecutorProvider, ExecutorProviderId } from "../../domain/provider/provider";
import { codexCliProvider } from "./codex-cli/provider";
import { opencodeProvider } from "./opencode/provider";

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
