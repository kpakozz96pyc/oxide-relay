import type { Permission } from "../../api";

type PermissionGroupDefinition = {
  id: string;
  title: string;
  codes: string[];
};

const PERMISSION_GROUPS: PermissionGroupDefinition[] = [
  {
    id: "user-management",
    title: "User management",
    codes: ["ManageUsers", "ManagePermissions"],
  },
  {
    id: "projects",
    title: "Projects",
    codes: ["CreateProjects", "ViewProjects", "EditProjects", "DeleteProjects", "ManageProjectMembers"],
  },
  {
    id: "translations",
    title: "Translations",
    codes: ["ReadTranslations", "EditTranslations", "DeleteTranslations", "ImportTranslations", "ExportTranslations"],
  },
];

export const ENVIRONMENT_PERMISSION_MATRIX = [
  {
    rowLabel: "Edit",
    values: [
      { columnLabel: "All except production", code: "EditAll" },
      { columnLabel: "Production", code: "EditProd" },
    ],
  },
] as const;

const MATRIX_CODES = new Set<string>(
  ENVIRONMENT_PERMISSION_MATRIX.flatMap((row) => row.values.map((value) => value.code)),
);

const GROUP_CODES = new Set(PERMISSION_GROUPS.flatMap((group) => group.codes));

export function buildPermissionGroups(permissionCatalog: Permission[]) {
  const byCode = new Map(permissionCatalog.map((permission) => [permission.code, permission] as const));

  const grouped = PERMISSION_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    permissions: group.codes
      .map((code) => byCode.get(code))
      .filter((permission): permission is Permission => Boolean(permission)),
  })).filter((group) => group.permissions.length > 0);

  const environmentPermissions = ENVIRONMENT_PERMISSION_MATRIX.map((row) => ({
    rowLabel: row.rowLabel,
    values: row.values
      .map((value) => ({
        columnLabel: value.columnLabel,
        permission: byCode.get(value.code) ?? null,
      }))
      .filter((value) => value.permission !== null),
  })).filter((row) => row.values.length > 0);

  const otherPermissions = permissionCatalog.filter(
    (permission) => !GROUP_CODES.has(permission.code) && !MATRIX_CODES.has(permission.code),
  );

  return {
    grouped,
    environmentPermissions,
    otherPermissions,
  };
}
