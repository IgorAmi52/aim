#!/bin/sh
set -eu

target="${1:-$HOME/aim-demo/payments}"
template="$(cd "$(dirname "$0")" && pwd)/payments"

if [ -e "$target" ] && [ ! -f "$target/.git/aim-demo" ]; then
  echo "$target exists and is not an aim demo repository; refusing to replace it" >&2
  exit 1
fi

rm -rf "$target"
mkdir -p "$(dirname "$target")"
cp -R "$template" "$target"
cd "$target"
git init -q -b main
touch .git/aim-demo
git config user.name "Igor"
git config user.email "igor@acme.dev"
git remote add origin git@github.com:acme/payments.git
git add -A
git commit -q -m "feat: payments service"
echo "Demo repository ready at $target"
