export function readEnvironmentPermission(environmentSlug: string) {
  switch (environmentSlug) {
    case "development":
      return "ReadDevelopment";
    case "staging":
      return "ReadStaging";
    case "production":
      return "ReadProduction";
    default:
      return "";
  }
}

export function editEnvironmentPermission(environmentSlug: string) {
  switch (environmentSlug) {
    case "development":
      return "EditDevelopment";
    case "staging":
      return "EditStaging";
    case "production":
      return "EditProduction";
    default:
      return "";
  }
}
