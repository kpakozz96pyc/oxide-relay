import { useQuery } from "@tanstack/react-query";
import { apiGet, CurrentPermissionsResponse } from "../api";

export function usePermissionSet() {
  const permissionsQuery = useQuery({
    queryKey: ["current-permissions"],
    queryFn: () => apiGet<CurrentPermissionsResponse>("/api/v1/me/permissions"),
    retry: false,
  });

  const permissions = permissionsQuery.data?.permissions ?? [];
  return {
    permissions,
    has(permission: string) {
      return permissions.includes(permission);
    },
  };
}
