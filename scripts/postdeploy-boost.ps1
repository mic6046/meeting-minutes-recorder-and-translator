# Re-apply Cloud Run scale / resource settings after Firebase App Hosting deploy.
# Keeps REQUEST-BASED billing (cpu-throttling). Do NOT use --no-cpu-throttling
# (that switches the service to instance-based billing).
param(
  [string]$Project = "gen-lang-client-0135145658",
  [string]$Service = "meeting-minutes",
  [string]$Region = "asia-southeast1"
)

Write-Host "Aligning $Service in $Region ($Project) to request-based billing (min=0, max=2)..."
gcloud run services update $Service `
  --region=$Region `
  --project=$Project `
  --min-instances=0 `
  --max-instances=2 `
  --memory=4Gi `
  --cpu=2 `
  --concurrency=2 `
  --timeout=900 `
  --cpu-throttling `
  --cpu-boost

$desc = gcloud run services describe $Service --region=$Region --project=$Project --format=json | ConvertFrom-Json
$annotations = $desc.spec.template.metadata.annotations
$minScale = $annotations.'autoscaling.knative.dev/minScale'
$maxScale = $annotations.'autoscaling.knative.dev/maxScale'
$cpuThrottling = $annotations.'run.googleapis.com/cpu-throttling'

# Missing or 'true' => request-based; 'false' => instance-based
$billingMode = if ($cpuThrottling -eq 'false') { 'instance-based (BAD)' } else { 'request-based (OK)' }

Write-Host "Done. billing=$billingMode cpu-throttling=$cpuThrottling minScale=$minScale maxScale=$maxScale"
if ($cpuThrottling -eq 'false') {
  Write-Error "Cloud Run is still on instance-based billing. Re-run with --cpu-throttling."
  exit 1
}
