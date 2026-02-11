{{/*
Chart name, truncated to 63 characters.
*/}}
{{- define "aether-os.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name (release-chart), truncated to 63 characters.
*/}}
{{- define "aether-os.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Standard labels for all resources.
*/}}
{{- define "aether-os.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "aether-os.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (used in matchLabels).
*/}}
{{- define "aether-os.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aether-os.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Kernel component labels.
*/}}
{{- define "aether-os.kernelLabels" -}}
{{ include "aether-os.labels" . }}
app.kubernetes.io/component: kernel
{{- end }}

{{/*
Kernel selector labels.
*/}}
{{- define "aether-os.kernelSelectorLabels" -}}
{{ include "aether-os.selectorLabels" . }}
app.kubernetes.io/component: kernel
{{- end }}

{{/*
UI component labels.
*/}}
{{- define "aether-os.uiLabels" -}}
{{ include "aether-os.labels" . }}
app.kubernetes.io/component: ui
{{- end }}

{{/*
UI selector labels.
*/}}
{{- define "aether-os.uiSelectorLabels" -}}
{{ include "aether-os.selectorLabels" . }}
app.kubernetes.io/component: ui
{{- end }}
