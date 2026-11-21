#!/bin/sh
# Checks before a commit: formatting, vet, staticcheck, the tests, the race
# detector, and the length of the files. See docs/agents/conventions.md.
set -eu
cd "$(dirname "$0")/.."
export CGO_ENABLED=0

echo "• gofmt"
bad=$(gofmt -l cmd internal)
if [ -n "$bad" ]; then
	echo "not formatted:"; echo "$bad"; exit 1
fi

echo "• go vet"
go vet ./...

echo "• staticcheck"
go tool staticcheck ./...

echo "• go test"
go test ./...

# The race detector needs cgo, which the packages of MyGo's UI cannot link
# with: it runs on the others.
echo "• go test -race"
CGO_ENABLED=1 go test -race $(go list ./... | grep -v -e /internal/shell -e /cmd/aibo)

echo "• file length"
status=0
for f in $(find cmd internal -name '*.go' ! -name '*_gen.go'); do
	n=$(wc -l < "$f")
	if [ "$n" -gt 1000 ]; then
		echo "  $f: $n lines, over 1000: split it"; status=1
	elif [ "$n" -gt 800 ]; then
		echo "  $f: $n lines, over 800: split it when you next change it"
	fi
done
[ $status -eq 0 ] || exit 1

echo "ok"
