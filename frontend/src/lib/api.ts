export type ApiErrorBody = {
  error?: { code?: string; message?: string };
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function fallbackMessage(path: string, status: number) {
  if (path === "/api/v1/profile/avatar") {
    if (status === 404)
      return "Profile picture uploads are unavailable. Restart the API and try again.";
    if (status === 413) return "Choose an image smaller than 768 KB.";
    if (status === 415) return "Choose a JPG, PNG, or WebP image.";
  }
  return "Something went wrong. Please try again.";
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const isFormData = init.body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body && !isFormData
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // The fallback below keeps transport failures user-safe and consistent.
    }
    throw new ApiError(
      response.status,
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? fallbackMessage(path, response.status),
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}
