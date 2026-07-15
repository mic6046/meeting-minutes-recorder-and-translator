# Re-apply warm Cloud Run settings after Firebase App Hosting deploy.
# App Hosting often leaves revision minScale at 0 even when apphosting.yaml has minInstances: 1.
param(
  [string]$Project = "gen-lang-client-0135145658",
  [string]$Service = "meeting-minutes",
  [string]$Region = "asia-southeast1"
)

Write-Host "Boosting $Service in $Region ($Project)..."
gcloud run services update $Service `
  --region=$Region `
  --project=$Project `
  --min-instances=1 `
  --memory=4Gi `
  --cpu=2 `
  --concurrency=10 `
  --no-cpu-throttling

Write-Host "Done. Verify with: gcloud run services describe $Service --region=$Region --project=$Project --format=\"value(spec.template.metadata.annotations['autoscaling.knative.dev/minScale'])\""
