#!/bin/bash
set -euo pipefail

args=$(jq -nr --arg image "${BOT_IMAGE:?image digest required}" \
  --arg compose "$(base64 < compose.yaml | tr -d '\n')" \
  --arg region "${AWS_REGION:?AWS region required}" '[$image, $compose, $region] | @sh')
command="printf %s $(base64 < scripts/deploy.sh | tr -d '\n') | base64 --decode | bash -s -- $args"
parameters=$(jq -n --arg command "$command" '{commands: [$command], executionTimeout: ["900"]}')
command_id=$(aws ssm send-command --instance-ids "${INSTANCE_ID:?instance ID required}" \
  --document-name AWS-RunShellScript --timeout-seconds 120 \
  --parameters "$parameters" --query Command.CommandId --output text)
echo "SSM command: $command_id"

status=0
aws ssm wait command-executed --command-id "$command_id" --instance-id "$INSTANCE_ID" || status=$?
aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" \
  --query '{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}' --output json

if (( status != 0 )); then
  echo "デプロイの正常終了を確認できませんでした。EC2 側では続行中の場合があります。再実行前に SSM command $command_id の状態を確認してください。" >&2
fi
exit "$status"
