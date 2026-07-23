import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

export type InteractionMode = "authoring" | "translated_view";

export const MUTATION_INTENTS = [
  "canvas_create",
  "canvas_edit",
  "canvas_delete",
  "canvas_move",
  "canvas_resize",
  "canvas_nest",
  "canvas_connect",
  "canvas_layout",
  "draft_edit",
  "chat_send",
  "chat_clear",
  "add_as_card",
  "proposal_edit",
  "proposal_resolve",
  "reflection_resolve",
  "candidate_transition",
  "assistance_change",
  "conversation_continue",
  "recovery_retry",
  "map_undo",
  "connection_setting",
  "map_clear",
  "draft_clear",
] as const;

export type MutationIntent = (typeof MUTATION_INTENTS)[number];

export interface MutationRejection {
  status: "rejected";
  reason: "read_only_view";
  intent: MutationIntent;
}

export type MutationRunResult<T> =
  | { status: "applied"; value: T }
  | MutationRejection;

export interface MutationAccess {
  mode: InteractionMode;
  allows: (intent: MutationIntent) => boolean;
  run: <T>(intent: MutationIntent, mutation: () => T) => MutationRunResult<T>;
}

export function inspectMutation(
  mode: InteractionMode,
  intent: MutationIntent,
): MutationRejection | null {
  return mode === "translated_view"
    ? { status: "rejected", reason: "read_only_view", intent }
    : null;
}

export function createMutationAccess(mode: InteractionMode): MutationAccess {
  return {
    mode,
    allows: (intent) => inspectMutation(mode, intent) === null,
    run: (intent, mutation) => {
      const rejection = inspectMutation(mode, intent);
      return rejection ?? { status: "applied", value: mutation() };
    },
  };
}

const MutationAccessContext = createContext<MutationAccess>(createMutationAccess("authoring"));

export function MutationPolicyProvider({
  children,
  mode = "authoring",
}: {
  children?: ReactNode;
  mode?: InteractionMode;
}) {
  const access = useMemo(() => createMutationAccess(mode), [mode]);
  return (
    <MutationAccessContext.Provider value={access}>
      {children}
    </MutationAccessContext.Provider>
  );
}

export function useMutationAccess(): MutationAccess {
  return useContext(MutationAccessContext);
}
