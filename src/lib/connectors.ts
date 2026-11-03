/**
 * Connectors available to a workflow.
 *
 * Phase 9 (a real external connector) was never started, so there is exactly one
 * executor here and it is explicitly simulated: it performs no network request,
 * writes nothing anywhere, and says so in its result. The approval and action
 * record model in 0013 is the one a real connector will reuse later: an action
 * only runs with an approval for its exact content, destination and connector,
 * and each run step can have exactly one action record.
 *
 * There is deliberately no arbitrary HTTP executor, no code executor and no
 * browser automation. Adding one would require a new step kind and a new
 * migration, not a configuration flag.
 */

export type ConnectorId = "demo_notes";

export type ConnectorDefinition = {
  id: ConnectorId;
  label: string;
  description: string;
  actionKind: "save_document";
  destinationHint: string;
  /** True until a real, reviewed connector replaces this one. */
  simulated: boolean;
};

export const CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: "demo_notes",
    label: "Demo notes (simulated)",
    description:
      "A dry run. The approved text is recorded in GET TO IT and nothing leaves the app.",
    actionKind: "save_document",
    destinationHint: "e.g. Weekly updates (demo)",
    simulated: true,
  },
];

export function isConnectorId(value: string): value is ConnectorId {
  return CONNECTORS.some((connector) => connector.id === value);
}

export function getConnector(id: string): ConnectorDefinition | null {
  return CONNECTORS.find((connector) => connector.id === id) ?? null;
}

export function connectorLabel(id: string): string {
  return getConnector(id)?.label ?? id;
}

export type ConnectorRequest = {
  connector: ConnectorId;
  destination: string;
  content: string;
  idempotencyKey: string;
};

export type ConnectorOutcome = "succeeded" | "failed" | "outcome_uncertain";

export type ConnectorResult = {
  status: ConnectorOutcome;
  externalRef?: string;
  message: string;
};

export interface ConnectorExecutor {
  execute(request: ConnectorRequest): Promise<ConnectorResult>;
}

/**
 * The only executor in the app. It is deterministic, performs no I/O, and
 * returns a reference that is clearly a local record rather than an external id.
 */
export const demoConnector: ConnectorExecutor = {
  async execute(request) {
    if (request.content.trim() === "") {
      return {
        status: "failed",
        message: "There was no approved content to save, so nothing was attempted.",
      };
    }

    return {
      status: "succeeded",
      externalRef: `demo-${request.idempotencyKey.slice(-12)}`,
      message:
        "Simulated action recorded. No external service was contacted and no data left GET TO IT.",
    };
  },
};

export function executorFor(id: string): ConnectorExecutor | null {
  if (id === "demo_notes") return demoConnector;
  return null;
}

/** A real, non-simulated connector is not configured in this build. */
export function hasRealConnector(): boolean {
  return CONNECTORS.some((connector) => !connector.simulated);
}

export const NO_REAL_CONNECTOR_NOTE =
  "Only a simulated connector is available in this build. It makes no external request, and every action still needs its own exact-content approval.";
