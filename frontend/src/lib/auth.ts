import { usingConvex } from "./backend";
import * as convexHooks from "./convex/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "./api";

export type Creator = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
};

type AuthResponse = {
  data: { user: Creator; confirmationRequired?: boolean };
};

export type LoginInput = { email: string; password: string };
export type RegisterInput = LoginInput & { username: string };
/** The Go API resets through an emailed link and ignores email and code. */
export type ResetPasswordInput = {
  email: string;
  code: string;
  password: string;
};

/**
 * Convex emails a code that is entered on the forgot-password page, then
 * signs the person in; the Go API emails a link to /reset-password.
 */
export const passwordResetByCode = usingConvex;

const meKey = ["creator", "me"] as const;

async function getMe(): Promise<Creator | null> {
  try {
    return (await apiRequest<AuthResponse>("/api/v1/me")).data.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

function useMeGo() {
  return useQuery({ queryKey: meKey, queryFn: getMe, staleTime: 30_000 });
}

function useLoginGo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      apiRequest<AuthResponse>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: ({ data }) => queryClient.setQueryData(meKey, data.user),
  });
}

function useRegisterGo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      apiRequest<AuthResponse>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: ({ data }) => {
      if (!data.confirmationRequired) {
        queryClient.setQueryData(meKey, data.user);
      }
    },
  });
}

function useForgotPasswordGo() {
  return useMutation({
    mutationFn: (email: string) =>
      apiRequest<void>("/api/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
  });
}

function useResetPasswordGo() {
  return useMutation({
    mutationFn: ({ password }: ResetPasswordInput) =>
      apiRequest<void>("/api/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
  });
}

function useLogoutGo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<void>("/api/v1/auth/logout", { method: "POST" }),
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["social"] });
      queryClient.removeQueries({ queryKey: ["social"] });
      queryClient.setQueryData(meKey, null);
    },
  });
}

// The Convex build swaps in src/lib/convex/hooks.ts (see lib/backend.ts).
export const useMe = usingConvex ? convexHooks.useMe : useMeGo;
export const useLogin = usingConvex ? convexHooks.useLogin : useLoginGo;
export const useRegister = usingConvex
  ? convexHooks.useRegister
  : useRegisterGo;
export const useForgotPassword = usingConvex
  ? convexHooks.useForgotPassword
  : useForgotPasswordGo;
export const useResetPassword = usingConvex
  ? convexHooks.useResetPassword
  : useResetPasswordGo;
export const useLogout = usingConvex ? convexHooks.useLogout : useLogoutGo;
