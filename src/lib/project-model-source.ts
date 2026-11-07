import { createHash } from "node:crypto";
import type {
  ModelDeployment,
  ModelFile,
  ModelIntegration,
  ModelSpec,
  ProjectModelInput,
} from "@/lib/project-model";

/** Source identity for a project-model version. Server-only. */

export type ModelSource = {
  spec_version: number;
  app_version: number;
  file_count: number;
  integration_count: number;
  deployment_count: number;
  source_digest: string;
  deployment_ids: string[];
  integration_ids: string[];
};

export type ModelSourceInput = {
  project: ProjectModelInput["project"];
  spec: ModelSpec | null;
  files: ModelFile[];
  integrations: ModelIntegration[];
  deployments: ModelDeployment[];
};

/**
 * A deterministic digest of everything the model reads. A stale warning means
 * this digest differs from the one stored with the model version.
 */
export function buildModelSource(input: ModelSourceInput): ModelSource {
  const hash = createHash("sha256");

  hash.update("project\0");
  hash.update(input.project.id);
  hash.update("\0");
  hash.update(String(input.project.current_version));
  hash.update("\0");
  hash.update(input.project.auth_requirements);
  hash.update("\0");

  hash.update("spec\0");
  if (input.spec) {
    hash.update(String(input.spec.version));
    hash.update("\0");
    hash.update(input.spec.approved_at ?? "draft");
    hash.update("\0");
    hash.update(JSON.stringify(input.spec.spec));
  } else {
    hash.update("none");
  }
  hash.update("\0");

  for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }

  for (const integration of [...input.integrations].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(integration.id);
    hash.update("\0");
    hash.update(integration.updated_at);
    hash.update("\0");
    hash.update(integration.status);
    hash.update("\0");
    hash.update(integration.last_test_status);
    hash.update("\0");
    hash.update(integration.allowed_operations.join(","));
    hash.update("\0");
  }

  for (const deployment of [...input.deployments].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(deployment.id);
    hash.update("\0");
    hash.update(deployment.status);
    hash.update("\0");
    hash.update(String(deployment.snapshot_version));
    hash.update("\0");
  }

  return {
    spec_version: input.spec?.version ?? 0,
    app_version: input.project.current_version,
    file_count: input.files.length,
    integration_count: input.integrations.length,
    deployment_count: input.deployments.length,
    source_digest: hash.digest("hex"),
    deployment_ids: input.deployments.map((deployment) => deployment.id),
    integration_ids: input.integrations.map((integration) => integration.id),
  };
}

export function modelStaleness(
  model: { spec_version: number; app_version: number; source_digest: string },
  current: ModelSource,
): { stale: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (model.spec_version !== current.spec_version) {
    reasons.push(`The specification changed from version ${model.spec_version} to ${current.spec_version}.`);
  }
  if (model.app_version !== current.app_version) {
    reasons.push(`The project changed from version ${model.app_version} to ${current.app_version}.`);
  }
  if (model.source_digest !== current.source_digest) {
    reasons.push("Stored files, integration metadata or deployment records changed.");
  }
  return { stale: reasons.length > 0, reasons };
}
