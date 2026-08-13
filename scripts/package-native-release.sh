#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

read -r package_name package_version binary_name <<<"$(cargo metadata --no-deps --format-version 1 | python3 -c 'import json, sys
metadata = json.load(sys.stdin)
root_id = metadata.get("resolve", {}).get("root")
packages = {pkg["id"]: pkg for pkg in metadata["packages"]}
package = packages.get(root_id) or metadata["packages"][0]
binary_names = [target["name"] for target in package["targets"] if "bin" in target["kind"]]
if not binary_names:
    raise SystemExit("No binary target found in root package")
print(package["name"], package["version"], binary_names[0])
')"

release_version="${1:-${RELEASE_VERSION:-$package_version}}"
artifact_name="${package_name}-${release_version}-linux-x86_64"
artifact_path="dist/${artifact_name}.tar.gz"
staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT

npm ci --prefix frontend
npm run build --prefix frontend
cargo build --locked --release

package_root="${staging_dir}/${artifact_name}"
mkdir -p "${package_root}/backend" "${package_root}/frontend"

cp "target/release/${binary_name}" "${package_root}/${binary_name}"
chmod 0755 "${package_root}/${binary_name}"
cp "backend/config.toml.example" "${package_root}/backend/config.toml.example"
cp -R "frontend/dist" "${package_root}/frontend/dist"

mkdir -p dist
rm -f "$artifact_path"
tar -C "$staging_dir" -czf "$artifact_path" "$artifact_name"

echo "Created ${artifact_path}"
