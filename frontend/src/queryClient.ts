import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from "@tanstack/react-query";
import type { ApiError } from "./api";

function isUnauthorized(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as ApiError).status === 401;
}

/**
 * A session invalidated elsewhere (expiry, self-delete, a password reset closing every
 * session) only clears itself on the next successful /api/v1/me check. Without this, a
 * protected query or mutation that gets a 401 mid-session just renders an error banner in
 * place — RequireAuth never re-evaluates because the cached ["session"] data still looks
 * valid. Clearing it here on any 401 makes that re-evaluation (and the redirect to
 * /login) happen on the very next render, from wherever the user was navigating.
 */
export function createQueryClient(defaultOptions?: DefaultOptions): QueryClient {
  let queryClient: QueryClient;

  const handleUnauthorized = (error: unknown) => {
    if (isUnauthorized(error)) {
      queryClient.setQueryData(["session"], null);
    }
  };

  queryClient = new QueryClient({
    defaultOptions,
    queryCache: new QueryCache({ onError: handleUnauthorized }),
    mutationCache: new MutationCache({ onError: handleUnauthorized }),
  });

  return queryClient;
}
