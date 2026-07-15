# Re-apply warm Cloud Run settings after Firebase App Hosting deploy.
# App Hosting often leaves revision minScale at 0 even when apphosting.yaml has minInstances: 1.
param(
  [string]$Project = "gen-lang-client-0135145658",
  [string]$Service = "meeting-minutes",
  [string]$Region = "asia-southeast1"
)

Write-Host "Boosting $Service in $Region ($Project) for meeting generation..."
gcloud run services update $Service `
  --region=$Region `
  --project=$Project `
  --min-instances=1 `
  --memory=4Gi `
  --cpu=2 `
  --concurrency=5 `
  --timeout=900 `
  --no-cpu-throttling `
  --cpu-boost

$desc = gcloud run services describe $Service --region=$Region --project=$Project --format=json | ConvertFrom-Json
$minScale = $desc.spec.template.metadata.annotations.'autoscaling.knative.dev/minScale'
Write-Host "Done. minScale=$minScale"
