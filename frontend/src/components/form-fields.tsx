import type { ComponentProps, ReactNode } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { ApiError } from "../lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// Composed fields for react-hook-form + zod. Each one wires a shadcn control to
// a form field with its label, help text, and validation message (the message
// replaces the help text while the field is invalid), so a form is
// a list of fields rather than repeated plumbing. Reach for the raw
// FormField/FormItem primitives only when a field needs a custom layout.

type FieldBase<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: ReactNode;
  description?: ReactNode;
  /** Rendered on the label row, opposite the label (e.g. "Forgot password?"). */
  labelAside?: ReactNode;
  className?: string;
};

type ControlledProps =
  "name" | "value" | "defaultValue" | "onChange" | "onBlur";

function FieldLabel({
  label,
  labelAside,
}: {
  label: ReactNode;
  labelAside?: ReactNode;
}) {
  if (!labelAside) return <FormLabel>{label}</FormLabel>;
  return (
    <div className="flex items-center justify-between gap-4">
      <FormLabel>{label}</FormLabel>
      {labelAside}
    </div>
  );
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  labelAside,
  className,
  ...inputProps
}: FieldBase<T> & Omit<ComponentProps<typeof Input>, ControlledProps>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem className={className}>
          <FieldLabel label={label} labelAside={labelAside} />
          <FormControl>
            <Input {...inputProps} {...field} value={field.value ?? ""} />
          </FormControl>
          {description && !fieldState.error && (
            <FormDescription>{description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  labelAside,
  className,
  ...textareaProps
}: FieldBase<T> & Omit<ComponentProps<typeof Textarea>, ControlledProps>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem className={className}>
          <FieldLabel label={label} labelAside={labelAside} />
          <FormControl>
            <Textarea {...textareaProps} {...field} value={field.value ?? ""} />
          </FormControl>
          {description && !fieldState.error && (
            <FormDescription>{description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  labelAside,
  className,
  options,
  placeholder,
  disabled,
  "aria-label": ariaLabel,
}: FieldBase<T> & {
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem className={className}>
          <FieldLabel label={label} labelAside={labelAside} />
          <Select
            value={field.value}
            onValueChange={field.onChange}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger
                ref={field.ref}
                onBlur={field.onBlur}
                aria-label={ariaLabel}
              >
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && !fieldState.error && (
            <FormDescription>{description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
}: Omit<FieldBase<T>, "labelAside"> & { disabled?: boolean }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem className={className}>
          <div className="flex items-center gap-3">
            <FormControl>
              <Switch
                ref={field.ref}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
                disabled={disabled}
              />
            </FormControl>
            <FormLabel>{label}</FormLabel>
          </div>
          {description && !fieldState.error && (
            <FormDescription>{description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// The server's safe message for a failed submit, or a generic retry line when
// the request never reached the API.
export function FormError({
  error,
  fallback = "Unable to connect. Please try again.",
  className,
}: {
  error: unknown;
  fallback?: string;
  className?: string;
}) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : fallback;
  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
