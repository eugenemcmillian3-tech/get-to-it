"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import {
  attachCustomDomainAction,
  createSupportRequestAction,
  startBillingCheckoutAction,
} from "@/lib/actions/billing";
import { offerPriceLabel } from "@/lib/billing/offers";
import {
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
} from "@/lib/styles";
import type { BillingOffer } from "@/lib/types";

export function BillingOfferForm({
  offer,
  workspaces,
  enabled,
}: {
  offer: BillingOffer;
  workspaces: { id: string; name: string }[];
  enabled: boolean;
}) {
  const [state, formAction] = useActionState(
    startBillingCheckoutAction,
    idleFormState,
  );
  const [quantity, setQuantity] = useState(offer.min_quantity);
  const needsWorkspace = offer.seat_based;
  const blocked = !enabled || (needsWorkspace && workspaces.length === 0);

  return (
    <form
      action={formAction}
      className="flex h-full flex-col rounded-2xl border border-line bg-card p-4"
    >
      <input type="hidden" name="offer_slug" value={offer.slug} />

      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-bold leading-snug">{offer.label}</h3>
        <p className="shrink-0 text-right text-lg font-black">
          {offerPriceLabel(offer.price_cents, quantity)}
        </p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">{offer.description}</p>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {offer.duration_days === null
          ? "One-time, no renewal"
          : `${offer.duration_days}-day pass, no auto-renew`}
      </p>

      {offer.max_quantity > 1 ? (
        <div className="mt-4">
          <label className={labelClass} htmlFor={`quantity-${offer.slug}`}>
            {offer.quantity_label}
          </label>
          <input
            id={`quantity-${offer.slug}`}
            name="quantity"
            type="number"
            min={offer.min_quantity}
            max={offer.max_quantity}
            step={1}
            value={quantity}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              setQuantity(Number.isFinite(next) ? next : offer.min_quantity);
            }}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            The owner is seat one. Five seats means the owner plus four other people.
          </p>
        </div>
      ) : (
        <input type="hidden" name="quantity" value={offer.min_quantity} />
      )}

      {needsWorkspace ? (
        <div className="mt-4">
          <label className={labelClass} htmlFor={`workspace-${offer.slug}`}>
            Workspace
          </label>
          {workspaces.length === 0 ? (
            <p className="mt-1 text-sm text-muted">
              You own no workspace yet. Create one first, then buy seats.
            </p>
          ) : (
            <select
              id={`workspace-${offer.slug}`}
              name="workspace_id"
              className={`mt-1.5 ${inputClass}`}
              required
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : null}

      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`mt-3 text-sm ${state.status === "error" ? "text-danger" : "text-mint"}`}
        >
          {state.message}
        </p>
      ) : null}

      <div className="mt-auto pt-4">
        <SubmitButton
          pendingLabel="Opening checkout…"
          className={`${primaryButton} w-full`}
          disabled={blocked}
        >
          {enabled ? "Buy this offer" : "Checkout unavailable"}
        </SubmitButton>
        <p className={`${hintClass} mt-2`}>
          Test mode only. No AI credits are included.
        </p>
      </div>
    </form>
  );
}

export function SupportRequestForm() {
  const [state, formAction] = useActionState(
    createSupportRequestAction,
    idleFormState,
  );

  return (
    <form action={formAction} className="mt-3 rounded-2xl border border-line bg-card p-4">
      <div>
        <label className={labelClass} htmlFor="support-subject">
          Subject
        </label>
        <input
          id="support-subject"
          name="subject"
          required
          minLength={3}
          maxLength={160}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div className="mt-3">
        <label className={labelClass} htmlFor="support-body">
          What do you need?
        </label>
        <textarea
          id="support-body"
          name="body"
          required
          minLength={3}
          maxLength={4000}
          rows={4}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`mt-3 text-sm ${state.status === "error" ? "text-danger" : "text-mint"}`}
        >
          {state.message}
        </p>
      ) : null}
      <div className="mt-3">
        <SubmitButton pendingLabel="Recording…" className={primaryButton}>
          Record priority request
        </SubmitButton>
      </div>
    </form>
  );
}

export function CustomDomainForm({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState(
    attachCustomDomainAction,
    idleFormState,
  );

  return (
    <form action={formAction} className="mt-3 rounded-2xl border border-line bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="domain-project">
            App project
          </label>
          <select
            id="domain-project"
            name="project_id"
            required
            className={`mt-1.5 ${inputClass}`}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="domain-name">
            Domain
          </label>
          <input
            id="domain-name"
            name="domain"
            required
            placeholder="app.example.com"
            maxLength={253}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>
      {projects.length === 0 ? (
        <p className={`${hintClass} mt-2`}>
          Create and connect a Vercel app project first.
        </p>
      ) : null}
      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`mt-3 text-sm ${state.status === "error" ? "text-danger" : "text-mint"}`}
        >
          {state.message}
        </p>
      ) : null}
      <div className="mt-3">
        <SubmitButton
          pendingLabel="Attaching…"
          className={`${primaryButton} ${focusRing}`}
          disabled={projects.length === 0}
        >
          Attach to Vercel
        </SubmitButton>
      </div>
      <p className={`${hintClass} mt-2`}>
        You still add the DNS records at your registrar. Vercel verifies them
        automatically after they propagate; this app cannot edit your registrar.
      </p>
    </form>
  );
}
