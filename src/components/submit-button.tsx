"use client";

import { useFormStatus } from "react-dom";
import { primaryButton } from "@/lib/styles";

type SubmitButtonProps = {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
};

export function SubmitButton({
  children,
  pendingLabel,
  className,
  name,
  value,
  disabled,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      className={className ?? primaryButton}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
