#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 apply|verify ENV_FILE" >&2
  exit 2
}

command_name="${1:-}"
env_file="${2:-}"

if [[ -z "$command_name" || -z "$env_file" || $# -ne 2 ]]; then
  usage
fi

verify_environment() {
  local mode_count shadow_count canary_count secret_count

  mode_count="$(grep -c '^BOOKING_OPS_AUTOMATION_MODE=' "$env_file" || true)"
  shadow_count="$(grep -c '^BOOKING_OPS_AUTOMATION_MODE=shadow$' "$env_file" || true)"
  canary_count="$(grep -c '^BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS=' "$env_file" || true)"
  secret_count="$(grep -c '^BOOKING_OPS_AUTO_SEND_RUNNER_SECRET=' "$env_file" || true)"

  if [[ "$mode_count" -ne 1 || "$shadow_count" -ne 1 ]]; then
    echo "booking automation environment verification failed: expected exactly one shadow mode line" >&2
    return 1
  fi
  if [[ "$canary_count" -ne 0 ]]; then
    echo "booking automation environment verification failed: canary allowlist must be absent" >&2
    return 1
  fi
  if [[ "$secret_count" -ne 1 ]]; then
    echo "booking automation environment verification failed: expected exactly one runner secret key" >&2
    return 1
  fi

  echo "booking automation mode: shadow"
  echo "booking automation canary allowlist: absent"
  echo "runner secret key: present"
}

case "$command_name" in
  verify)
    [[ -f "$env_file" ]] || {
      echo "booking automation environment verification failed: environment file is absent" >&2
      exit 1
    }
    verify_environment
    ;;
  apply)
    runner_secret="$(cat)"
    if [[ -z "$runner_secret" ]]; then
      echo "booking automation environment update failed: runner secret is empty" >&2
      exit 1
    fi
    case "$runner_secret" in
      *$'\n'*|*$'\r'*)
        echo "booking automation environment update failed: runner secret must be a single line" >&2
        exit 1
        ;;
    esac

    env_dir="$(dirname -- "$env_file")"
    [[ -d "$env_dir" ]] || {
      echo "booking automation environment update failed: environment directory is absent" >&2
      exit 1
    }

    umask 077
    env_tmp="$(mktemp "${env_file}.tmp.XXXXXX")"
    trap 'rm -f -- "$env_tmp"' EXIT

    if [[ -f "$env_file" ]]; then
      grep -vE '^(BOOKING_OPS_AUTO_SEND_RUNNER_SECRET|BOOKING_OPS_AUTOMATION_MODE|BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS)=' \
        "$env_file" > "$env_tmp" || true
    fi
    printf 'BOOKING_OPS_AUTO_SEND_RUNNER_SECRET=%s\n' "$runner_secret" >> "$env_tmp"
    printf 'BOOKING_OPS_AUTOMATION_MODE=shadow\n' >> "$env_tmp"
    chmod 600 "$env_tmp"
    mv -f -- "$env_tmp" "$env_file"
    trap - EXIT
    chmod 600 "$env_file"

    verify_environment
    ;;
  *)
    usage
    ;;
esac
