// What batch, plan, dryRun and dispatch hand back: one short line of text by default,
// { ok, errors, warnings, results } on request. Commands that fail never throw from here.
import { CommandError } from "../model/commands";
import { lintProject } from "../model/lint";
import type { ProjectDocument } from "../model/types";

export type RunFormat = "text" | "json";

export interface VctRunReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** One entry per command (plan: one list per batch). */
  results: unknown[];
  /** Step name the next undo reverts (empty when nothing changed or in a simulation). */
  undo?: string;
  /** Ids that appeared: layers, tracks, audio clips and effects. */
  created?: string[];
  /** dryRun only: the commands remove something and will ask the person to confirm. */
  requiresConfirmation?: boolean;
}

const FEW_IDS = 6;
const SHOWN_WARNINGS = 3;

export function failureMessage(error: unknown, batch?: number) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CommandError && error.index !== undefined) {
    const where = batch === undefined ? `comando ${error.index + 1}` : `lote ${batch + 1}, comando ${error.index + 1}`;
    return `erro no ${where}${error.commandType ? ` (${error.commandType})` : ""}: ${message}`;
  }
  return batch === undefined ? `erro: ${message}` : `erro no lote ${batch + 1}: ${message}`;
}

/** The text form of a failure (also how the bridge tells a failed run from a good one). */
export const isFailureText = (text: unknown) => typeof text === "string" && /^erro( |:)/.test(text);

function ids(project: ProjectDocument) {
  return new Set([
    ...project.layers.flatMap((layer) => [layer.id, ...layer.effects.map((effect) => effect.id)]),
    ...project.audioTracks.flatMap((track) => [track.id, ...track.effects.map((effect) => effect.id)]),
    ...project.postEffects.map((effect) => effect.id),
    ...(project.tracks ?? []).map((track) => track.id),
  ]);
}

export function newIds(before: ProjectDocument, after: ProjectDocument) {
  const known = ids(before);
  return [...ids(after)].filter((id) => !known.has(id));
}

/** Lint problems the run introduced, so the agent only hears about its own changes. */
export function newWarnings(before: ProjectDocument, after: ProjectDocument) {
  const known = new Set(lintProject(before).map((issue) => issue.message));
  return lintProject(after).filter((issue) => !known.has(issue.message)).map((issue) => issue.message);
}

export interface ReportInput {
  dry: boolean;
  commands: number;
  batches?: number;
  changed: boolean;
  label: string;
  created: string[];
  warnings: string[];
  requiresConfirmation: boolean;
}

export function reportText(input: ReportInput) {
  const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;
  const parts = [input.dry ? "ok (simulação)" : "ok"];
  if (input.batches && input.batches > 1) parts.push(count(input.batches, "lote"));
  parts.push(count(input.commands, "comando"));
  if (!input.dry) parts.push(input.changed ? `desfazer: ${input.label}` : "sem mudanças");
  if (input.created.length) parts.push(`criados: ${input.created.length <= FEW_IDS ? input.created.join(" ") : input.created.length}`);
  if (input.dry && input.requiresConfirmation) parts.push("pede confirmação ao aplicar");
  if (input.warnings.length) {
    const more = input.warnings.length - SHOWN_WARNINGS;
    parts.push(`avisos: ${input.warnings.slice(0, SHOWN_WARNINGS).map((warning) => warning.replace(/\.$/, "")).join("; ")}${more > 0 ? ` (+${more}, veja lint())` : ""}`);
  }
  return parts.join(" · ");
}

export function failureReport(message: string): VctRunReport {
  return { ok: false, errors: [message], warnings: [], results: [] };
}
