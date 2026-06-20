import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../api";

export function useSession() {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => apiGet<{ user: { id: string; email: string; display_name: string } }>("/api/v1/me"),
    retry: false,
  });

  return {
    isLoading: sessionQuery.isLoading,
    user: sessionQuery.data?.user ?? null,
    async refresh() {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    async logout() {
      await apiPost("/api/v1/auth/logout", undefined);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  };
}
