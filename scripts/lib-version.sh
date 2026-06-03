#!/usr/bin/env bash
# lib-version.sh — read plugin.json version and compare semver-ish tuples
# shellcheck shell=bash

plugin_version() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$f"
}

# Prints: newer | older | equal  (arg1 relative to arg2)
version_relation() {
  python3 - "$1" "$2" <<'PY'
import sys

def parse(v: str) -> list:
    out = []
    for part in v.strip().split("."):
        num = ""
        rest = ""
        for ch in part:
            if ch.isdigit():
                if rest:
                    rest += ch
                else:
                    num += ch
            else:
                rest += ch
        if num:
            out.append(int(num))
        if rest:
            out.append(rest)
    return out

def cmp_ver(a: str, b: str) -> int:
    from itertools import zip_longest

    pa, pb = parse(a), parse(b)
    for x, y in zip_longest(pa, pb, fillvalue=0):
        if type(x) is type(y) is int:
            if x != y:
                return 1 if x > y else -1
        else:
            xs, ys = str(x), str(y)
            if xs != ys:
                return 1 if xs > ys else -1
    return 0

a, b = sys.argv[1], sys.argv[2]
r = cmp_ver(a, b)
if r > 0:
    print("newer")
elif r < 0:
    print("older")
else:
    print("equal")
PY
}

# Exit 0 = install/update needed; 1 = up to date; 2 = installed newer than source
install_needed() {
  local source_plugin="$1"
  local installed_plugin="$2"

  [[ -f "$source_plugin" ]] || {
    echo "install-needed: missing source $source_plugin" >&2
    return 0
  }

  if [[ ! -f "$installed_plugin" ]]; then
    echo "not-installed"
    return 0
  fi

  local src_ver inst_ver rel
  src_ver="$(plugin_version "$source_plugin")" || return 0
  inst_ver="$(plugin_version "$installed_plugin")" || return 0
  rel="$(version_relation "$src_ver" "$inst_ver")"

  case "$rel" in
    newer)
      echo "update:${inst_ver}->${src_ver}"
      return 0
      ;;
    equal)
      echo "current:${inst_ver}"
      return 1
      ;;
    older)
      echo "installed-newer:${inst_ver}>${src_ver}"
      return 2
      ;;
    *)
      return 0
      ;;
  esac
}
