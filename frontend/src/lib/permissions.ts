export function editEnvironmentPermission(environmentSlug: string) {
  return environmentSlug === "production" ? "EditProd" : "EditAll";
}
