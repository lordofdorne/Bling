import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "./api";

export type Creator = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
};

type AuthResponse = { data: { user: Creator } };

export type LoginInput = { email: string; password: string };
export type RegisterInput = LoginInput & { username: string };

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

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: getMe, staleTime: 30_000 });
}

export function useLogin() {
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

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      apiRequest<AuthResponse>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: ({ data }) => queryClient.setQueryData(meKey, data.user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<void>("/api/v1/auth/logout", { method: "POST" }),
    onSuccess: () => queryClient.setQueryData(meKey, null),
  });
}
