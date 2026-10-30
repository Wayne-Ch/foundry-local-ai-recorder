$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$fixtureDirectory = Join-Path $repositoryRoot "fixtures"
$fixturePath = Join-Path $fixtureDirectory "ode-lesson.wav"
New-Item -ItemType Directory -Force $fixtureDirectory | Out-Null

$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  16000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

try {
  $synthesizer.Rate = -1
  $synthesizer.Volume = 100
  $synthesizer.SetOutputToWaveFile($fixturePath, $format)
  $synthesizer.Speak(
    "An ordinary differential equation relates a function to its derivatives. " +
    "For the first order equation y prime equals negative two y, separate the variables. " +
    "The solution is y of t equals c times e to the negative two t. " +
    "The initial value determines the constant c."
  )
}
finally {
  $synthesizer.Dispose()
}

$file = Get-Item $fixturePath
Write-Output "ODE_FIXTURE_OK $($file.FullName) $($file.Length) bytes"
